import {
  Environment,
  SurfaceRoughness,
  WindGustSettings,
  WindLayer,
  WindProfile,
} from '../types';

const DEFAULT_LAYER_ALTITUDES = [0, 30, 100, 300];

const HELLMMAN_BY_ROUGHNESS: Record<SurfaceRoughness, number> = {
  water: 0.10,
  open: 0.14,
  suburban: 0.22,
  urban: 0.33,
};

const DEFAULT_GUSTS: WindGustSettings = {
  enabled: true,
  intensity: 0.12,
  frequency: 1.0,
  directionalVarianceDeg: 6,
  seed: 17,
};

const normalizeDirection = (deg: number): number => ((deg % 360) + 360) % 360;

const directionToVector = (speed: number, directionDeg: number) => {
  const fromRad = (normalizeDirection(directionDeg) * Math.PI) / 180;
  return {
    x: -speed * Math.sin(fromRad),
    y: -speed * Math.cos(fromRad),
  };
};

const vectorToDirection = (x: number, y: number): number => {
  const direction = (Math.atan2(-x, -y) * 180) / Math.PI;
  return normalizeDirection(direction);
};

const interpolate = (a: number, b: number, t: number) => a + (b - a) * t;

const sortLayers = (layers: WindLayer[]): WindLayer[] =>
  [...layers]
    .map((layer) => ({
      ...layer,
      altitude: Math.max(0, layer.altitude),
      speed: Math.max(0, layer.speed),
      direction: normalizeDirection(layer.direction),
      turbulenceIntensity: Math.max(0, Math.min(1, layer.turbulenceIntensity ?? 0)),
    }))
    .sort((a, b) => a.altitude - b.altitude);

export const createDefaultWindProfile = (
  windSpeed: number = 0,
  windDirection: number = 0
): WindProfile => {
  const baseSpeed = Math.max(0, windSpeed);
  const direction = normalizeDirection(windDirection);

  return {
    mode: 'constant',
    interpolation: 'linear',
    referenceHeight: 10,
    hellmannExponent: HELLMMAN_BY_ROUGHNESS.open,
    surfaceRoughness: 'open',
    layers: DEFAULT_LAYER_ALTITUDES.map((altitude, index) => ({
      altitude,
      speed: index === 0 ? baseSpeed : baseSpeed * Math.pow(Math.max(1, altitude) / 10, HELLMMAN_BY_ROUGHNESS.open),
      direction,
      turbulenceIntensity: index === 0 ? 0.04 : 0.06 + index * 0.02,
    })),
    gusts: { ...DEFAULT_GUSTS },
  };
};

export const normalizeWindProfile = (
  profile: WindProfile | undefined,
  env: Pick<Environment, 'windSpeed' | 'windDirection'>
): WindProfile => {
  const fallback = createDefaultWindProfile(env.windSpeed, env.windDirection);
  if (!profile) return fallback;

  const roughness = profile.surfaceRoughness ?? 'open';
  const hellmannExponent = Number.isFinite(profile.hellmannExponent)
    ? Math.max(0.05, Math.min(0.5, profile.hellmannExponent))
    : HELLMMAN_BY_ROUGHNESS[roughness];
  const referenceHeight = Number.isFinite(profile.referenceHeight)
    ? Math.max(1, profile.referenceHeight)
    : 10;
  const layers = sortLayers(profile.layers?.length ? profile.layers : fallback.layers);
  const gusts = {
    ...DEFAULT_GUSTS,
    ...profile.gusts,
    intensity: Math.max(0, Math.min(0.6, profile.gusts?.intensity ?? DEFAULT_GUSTS.intensity)),
    frequency: Math.max(0.1, Math.min(5, profile.gusts?.frequency ?? DEFAULT_GUSTS.frequency)),
    directionalVarianceDeg: Math.max(0, Math.min(45, profile.gusts?.directionalVarianceDeg ?? DEFAULT_GUSTS.directionalVarianceDeg)),
  };

  return {
    mode: profile.mode ?? 'constant',
    interpolation: 'linear',
    referenceHeight,
    hellmannExponent,
    surfaceRoughness: roughness,
    layers,
    gusts,
  };
};

export const syncEnvironmentWindScalars = (env: Environment): Environment => {
  const profile = normalizeWindProfile(env.windProfile, env);
  const groundLayer = profile.layers[0] ?? { altitude: 0, speed: env.windSpeed, direction: env.windDirection };
  return {
    ...env,
    windSpeed: groundLayer.speed,
    windDirection: groundLayer.direction,
    windProfile: profile,
  };
};

export interface WindSample {
  speed: number;
  direction: number;
  x: number;
  y: number;
  gustSpeedDelta: number;
  directionalOffsetDeg: number;
  turbulenceIntensity: number;
}

const sampleBaseLayer = (profile: WindProfile, altitude: number): WindSample => {
  const layers = profile.layers;
  if (layers.length === 0) {
    const base = directionToVector(0, 0);
    return {
      speed: 0,
      direction: 0,
      x: base.x,
      y: base.y,
      gustSpeedDelta: 0,
      directionalOffsetDeg: 0,
      turbulenceIntensity: 0,
    };
  }

  const h = Math.max(0, altitude);
  if (profile.mode === 'constant' && h > profile.referenceHeight) {
    const first = layers[0];
    const shearedSpeed = first.speed * Math.pow(h / profile.referenceHeight, profile.hellmannExponent);
    const v = directionToVector(shearedSpeed, first.direction);
    return {
      speed: shearedSpeed,
      direction: first.direction,
      x: v.x,
      y: v.y,
      gustSpeedDelta: 0,
      directionalOffsetDeg: 0,
      turbulenceIntensity: first.turbulenceIntensity ?? 0.05,
    };
  }

  if (h <= layers[0].altitude) {
    const v = directionToVector(layers[0].speed, layers[0].direction);
    return {
      speed: layers[0].speed,
      direction: layers[0].direction,
      x: v.x,
      y: v.y,
      gustSpeedDelta: 0,
      directionalOffsetDeg: 0,
      turbulenceIntensity: layers[0].turbulenceIntensity ?? 0.05,
    };
  }

  for (let i = 0; i < layers.length - 1; i++) {
    const lower = layers[i];
    const upper = layers[i + 1];
    if (h <= upper.altitude) {
      const span = Math.max(upper.altitude - lower.altitude, 1e-6);
      const t = (h - lower.altitude) / span;
      const lowerVec = directionToVector(lower.speed, lower.direction);
      const upperVec = directionToVector(upper.speed, upper.direction);
      const x = interpolate(lowerVec.x, upperVec.x, t);
      const y = interpolate(lowerVec.y, upperVec.y, t);
      const speed = Math.sqrt(x * x + y * y);
      return {
        speed,
        direction: vectorToDirection(x, y),
        x,
        y,
        gustSpeedDelta: 0,
        directionalOffsetDeg: 0,
        turbulenceIntensity: interpolate(lower.turbulenceIntensity ?? 0.05, upper.turbulenceIntensity ?? 0.08, t),
      };
    }
  }

  const top = layers[layers.length - 1];
  const v = directionToVector(top.speed, top.direction);
  return {
    speed: top.speed,
    direction: top.direction,
    x: v.x,
    y: v.y,
    gustSpeedDelta: 0,
    directionalOffsetDeg: 0,
    turbulenceIntensity: top.turbulenceIntensity ?? 0.1,
  };
};

export const sampleWindProfile = (
  env: Environment,
  altitude: number,
  time: number = 0
): WindSample => {
  const profile = normalizeWindProfile(env.windProfile, env);
  const base = sampleBaseLayer(profile, altitude);
  const gusts = profile.gusts ?? DEFAULT_GUSTS;

  if (!gusts.enabled || base.speed < 0.05) {
    return base;
  }

  const seed = gusts.seed ?? 17;
  const altitudeScale = Math.max(0.25, Math.min(1.5, 0.35 + altitude / 120));
  const turbulenceBoost = 1 + base.turbulenceIntensity * 1.8;
  const gustEnvelope = Math.min(0.65, gusts.intensity * altitudeScale * turbulenceBoost);
  const freq = gusts.frequency;
  const gustWave =
    Math.sin(time * 0.38 * freq + altitude * 0.017 + seed * 0.11) * 0.52 +
    Math.sin(time * 1.07 * freq + 1.3 + seed * 0.07) * 0.31 +
    Math.sin(time * 2.45 * freq + altitude * 0.006 + 0.4 + seed * 0.03) * 0.17;
  const gustSpeedDelta = base.speed * gustEnvelope * gustWave;
  const directionalOffsetDeg =
    gusts.directionalVarianceDeg *
    altitudeScale *
    (Math.sin(time * 0.27 * freq + altitude * 0.009 + seed * 0.05) * 0.62 +
      Math.sin(time * 0.83 * freq + 0.9 + seed * 0.02) * 0.38);

  const effectiveSpeed = Math.max(0, base.speed + gustSpeedDelta);
  const effectiveDirection = normalizeDirection(base.direction + directionalOffsetDeg);
  const effectiveVector = directionToVector(effectiveSpeed, effectiveDirection);

  return {
    speed: effectiveSpeed,
    direction: effectiveDirection,
    x: effectiveVector.x,
    y: effectiveVector.y,
    gustSpeedDelta,
    directionalOffsetDeg,
    turbulenceIntensity: base.turbulenceIntensity,
  };
};

export const perturbWindProfile = (
  env: Environment,
  speedDelta: number,
  directionDelta: number,
  gustScale: number = 0
): Environment => {
  const profile = normalizeWindProfile(env.windProfile, env);
  const nextProfile: WindProfile = {
    ...profile,
    layers: profile.layers.map((layer, index) => ({
      ...layer,
      speed: Math.max(0, layer.speed + speedDelta * (0.9 + index * 0.08)),
      direction: normalizeDirection(layer.direction + directionDelta),
      turbulenceIntensity: Math.max(
        0,
        Math.min(1, (layer.turbulenceIntensity ?? 0.05) * (1 + gustScale * 0.25))
      ),
    })),
    gusts: profile.gusts
      ? {
          ...profile.gusts,
          intensity: Math.max(0, Math.min(0.8, profile.gusts.intensity * (1 + gustScale))),
          directionalVarianceDeg: Math.max(
            0,
            Math.min(60, profile.gusts.directionalVarianceDeg * (1 + gustScale * 0.5))
          ),
        }
      : profile.gusts,
  };

  return syncEnvironmentWindScalars({
    ...env,
    windProfile: nextProfile,
  });
};

export const mphToMps = (mph: number): number => mph / 2.23694;
export const mpsToMph = (mps: number): number => mps * 2.23694;
