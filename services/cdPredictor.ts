/**
 * Professional Cd estimation and calibration service.
 *
 * Design goals:
 * - Use parsed rocket geometry instead of a few manual dropdowns
 * - Produce a drag budget that can be reviewed by a human
 * - Keep output compatible with the existing Analysis panel
 */

import { Environment, RocketComponent, RocketConfig } from '../types';
import { runSimulation } from './physics6dofStable';
import { calculateReferenceArea, findMaxDiameter } from './rocketUtils';

export interface CdPredictionInput {
  maxDiameter: number; // m
  referenceArea: number; // m²
  noseConeShape?: 'OGIVE' | 'CONICAL' | 'ELLIPSOID' | 'POWER_SERIES';
  finCount?: number;
  surfaceFinish?: 'SMOOTH' | 'NORMAL' | 'ROUGH';
  actualApogee?: number; // ft
  actualMass?: number; // g
  motorName?: string;
  environment?: Environment;
}

interface DragBreakdownEntry {
  label: string;
  cd: number;
  description: string;
}

interface GeometrySummary {
  bodyLength: number;
  totalLength: number;
  maxDiameter: number;
  referenceArea: number;
  noseLength: number;
  noseShape: string;
  finCount: number;
  finArea: number;
  finSpan: number;
  finThickness: number;
  launchLugCount: number;
  transitionCount: number;
  wettedArea: number;
  finenessRatio: number;
}

interface ReferenceCondition {
  velocity: number;
  mach: number;
  reynolds: number;
  density: number;
}

export interface CdPredictionResult {
  method: 'THEORETICAL' | 'CALIBRATED' | 'ESTIMATED';
  cd: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  explanation: string;
  details?: {
    baseCd?: number;
    corrections?: Array<{ factor: string; value: number; reason: string }>;
    calibrationError?: number;
    iterations?: number;
    breakdown?: DragBreakdownEntry[];
    geometry?: GeometrySummary;
    referenceCondition?: ReferenceCondition;
    cdRange?: { low: number; high: number };
  };
}

const G = 9.80665;
const R_GAS = 287.05;
const GAMMA = 1.4;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const getAtmosphere = (env?: Environment, altitude: number = 0) => {
  const source = env ?? {
    temperature: 20,
    pressure: 1013.25,
    humidity: 50,
    windSpeed: 0,
    windDirection: 0,
    airDensity: 1.225,
  };
  const temperatureK = (source.temperature ?? 20) + 273.15 - 0.0065 * altitude;
  const pressurePa = (source.pressure ?? 1013.25) * 100;
  const density = source.airDensity ?? pressurePa / (R_GAS * Math.max(temperatureK, 200));
  const soundSpeed = Math.sqrt(GAMMA * R_GAS * temperatureK);
  return {
    density,
    soundSpeed,
    dynamicViscosity: 1.81e-5,
  };
};

const getComponentLength = (component: RocketComponent): number => {
  switch (component.type) {
    case 'NOSECONE':
    case 'BODYTUBE':
    case 'TRANSITION':
    case 'INNER_TUBE':
    case 'SHOCK_CORD':
    case 'ENGINE_BLOCK':
    case 'MASS_COMPONENT':
    case 'LAUNCH_LUG':
      return (component as any).length || 0;
    case 'FINS':
      return (component as any).rootChord || 0;
    default:
      return 0;
  }
};

const walkComponents = (components: RocketComponent[], visit: (component: RocketComponent) => void) => {
  components.forEach((component) => {
    visit(component);
    if (component.subComponents?.length) {
      walkComponents(component.subComponents, visit);
    }
  });
};

const extractGeometrySummary = (rocket: RocketConfig, input: CdPredictionInput): GeometrySummary => {
  let bodyLength = 0;
  let totalLength = 0;
  let noseLength = 0;
  let finCount = input.finCount ?? 0;
  let finArea = 0;
  let finSpan = 0;
  let finThickness = 0;
  let launchLugCount = 0;
  let transitionCount = 0;
  let noseShape = input.noseConeShape ?? 'OGIVE';
  let wettedArea = 0;

  walkComponents(rocket.stages, (component) => {
    const length = getComponentLength(component);
    totalLength += ['NOSECONE', 'BODYTUBE', 'TRANSITION'].includes(component.type) ? length : 0;

    if (component.type === 'BODYTUBE') {
      const diameter = (component as any).diameter || 0;
      bodyLength += length;
      wettedArea += Math.PI * diameter * length;
    }

    if (component.type === 'NOSECONE') {
      const radius = ((component as any).baseDiameter || input.maxDiameter) / 2;
      noseLength += length;
      noseShape = (component as any).shape || noseShape;
      const slant = Math.sqrt(length * length + radius * radius);
      wettedArea += Math.PI * radius * slant * 0.9;
    }

    if (component.type === 'TRANSITION') {
      const fore = (component as any).foreDiameter || input.maxDiameter;
      const aft = (component as any).aftDiameter || input.maxDiameter;
      const avgDiameter = (fore + aft) / 2;
      transitionCount += 1;
      wettedArea += Math.PI * avgDiameter * Math.max(length, 0.005);
    }

    if (component.type === 'FINS') {
      const rootChord = (component as any).rootChord || 0;
      const tipChord = (component as any).tipChord || 0;
      const span = (component as any).height || 0;
      const thickness = (component as any).thickness || 0.003;
      const count = (component as any).finCount || finCount || 3;
      const singleFinPlanform = 0.5 * (rootChord + tipChord) * span;
      finCount = count;
      finArea += singleFinPlanform * count;
      finSpan = Math.max(finSpan, span);
      finThickness = Math.max(finThickness, thickness);
      wettedArea += singleFinPlanform * count * 2.04;
    }

    if (component.type === 'LAUNCH_LUG') {
      launchLugCount += 1;
      const lugDiameter = (component as any).outerDiameter || input.maxDiameter * 0.12;
      wettedArea += Math.PI * lugDiameter * Math.max(length, 0.01);
    }
  });

  const maxDiameter = input.maxDiameter || findMaxDiameter(rocket.stages);
  const referenceArea = input.referenceArea || calculateReferenceArea(rocket.stages);
  const finenessRatio = maxDiameter > 0 ? totalLength / maxDiameter : 8;

  return {
    bodyLength,
    totalLength,
    maxDiameter,
    referenceArea,
    noseLength,
    noseShape,
    finCount,
    finArea,
    finSpan,
    finThickness,
    launchLugCount,
    transitionCount,
    wettedArea,
    finenessRatio,
  };
};

const estimateReferenceCondition = (rocket: RocketConfig, env?: Environment, geometry?: GeometrySummary): ReferenceCondition => {
  const atmosphere = getAtmosphere(env);
  const launchMass = (rocket.simulationSettings?.mass ?? (rocket.manualOverride?.mass ?? 0) + rocket.motor.propellantMass) || 0.62;
  const avgThrust = rocket.motor.averageThrust ?? rocket.motor.totalImpulse / Math.max(rocket.motor.burnTime, 0.8);
  const thrustToWeight = avgThrust / Math.max(launchMass * G, 0.5);
  const velocity = clamp(18 + thrustToWeight * 8 + (geometry?.finenessRatio ?? 8) * 0.8, 24, 62);
  const mach = velocity / atmosphere.soundSpeed;
  const characteristicLength = geometry?.bodyLength || geometry?.totalLength || 0.6;
  const reynolds = (atmosphere.density * velocity * characteristicLength) / atmosphere.dynamicViscosity;
  return {
    velocity,
    mach,
    reynolds,
    density: atmosphere.density,
  };
};

const getFinishMultiplier = (finish: CdPredictionInput['surfaceFinish']) => {
  switch (finish) {
    case 'SMOOTH':
      return 0.9;
    case 'ROUGH':
      return 1.18;
    default:
      return 1.0;
  }
};

const getNosePressureCd = (shape: string, finenessRatio: number) => {
  const ratioFactor = clamp(10 / Math.max(5, finenessRatio), 0.65, 1.25);
  switch (shape) {
    case 'ELLIPSOID':
      return 0.028 * ratioFactor;
    case 'CONICAL':
      return 0.060 * ratioFactor;
    case 'POWER_SERIES':
      return 0.035 * ratioFactor;
    case 'OGIVE':
    default:
      return 0.032 * ratioFactor;
  }
};

const getMachRiseFactor = (mach: number): number => {
  if (mach < 0.45) return 1.0;
  if (mach < 0.8) return 1.0 + (mach - 0.45) * 0.55;
  if (mach < 1.05) return 1.20 + (mach - 0.8) * 2.0;
  return 1.70 + Math.min(0.5, (mach - 1.05) * 0.35);
};

export const predictCdFromGeometry = (rocket: RocketConfig, input: CdPredictionInput): CdPredictionResult => {
  const geometry = extractGeometrySummary(rocket, input);
  const reference = estimateReferenceCondition(rocket, input.environment, geometry);
  const finishMultiplier = getFinishMultiplier(input.surfaceFinish);

  const turbulentCf = 0.455 / Math.pow(Math.log10(Math.max(reference.reynolds, 1e5)), 2.58);
  const skinFrictionCd = clamp(
    turbulentCf * finishMultiplier * (geometry.wettedArea / Math.max(geometry.referenceArea, 1e-6)) * 0.18,
    0.018,
    0.18
  );

  const nosePressureCd = getNosePressureCd(geometry.noseShape, geometry.finenessRatio);
  const bodyPressureCd = clamp(0.010 + geometry.transitionCount * 0.006 + 0.004 * Math.max(0, 8 - geometry.finenessRatio), 0.01, 0.08);
  const finProfileCd = clamp(
    (geometry.finArea / Math.max(geometry.referenceArea, 1e-6)) *
      (0.010 + geometry.finThickness / Math.max(geometry.maxDiameter, 1e-4) * 0.25),
    0.02,
    0.16
  );
  const baseDragCd = clamp(
    0.11 - Math.min(0.04, Math.max(0, geometry.finenessRatio - 6) * 0.004),
    0.055,
    0.12
  );
  const excrescenceCd = 0.008 + geometry.launchLugCount * 0.006;

  const zeroLiftCd =
    (skinFrictionCd + nosePressureCd + bodyPressureCd + finProfileCd + baseDragCd + excrescenceCd) *
    getMachRiseFactor(reference.mach);

  const finalCd = clamp(zeroLiftCd, 0.28, 0.95);

  const breakdown: DragBreakdownEntry[] = [
    { label: 'Skin Friction', cd: skinFrictionCd, description: 'Boundary-layer drag from body, nose, fins, and exposed wetted area.' },
    { label: 'Nose / Forebody Pressure', cd: nosePressureCd, description: `Shape-dependent forebody form drag for ${geometry.noseShape.toLowerCase()} nose geometry.` },
    { label: 'Body / Transition Pressure', cd: bodyPressureCd, description: 'Pressure losses from shoulders, transitions, and finite fineness ratio.' },
    { label: 'Fin Profile / Interference', cd: finProfileCd, description: 'Fin section drag and body-fin interference based on planform and thickness.' },
    { label: 'Base Drag', cd: baseDragCd, description: 'Wake drag behind the aft body, dominant for blunt amateur rockets.' },
    { label: 'Excrescence / Hardware', cd: excrescenceCd, description: 'Launch lugs and small protrusions not captured by clean-body theory.' },
  ];

  const corrections = [
    { factor: 'Surface Finish', value: finishMultiplier, reason: 'Adjusts skin-friction level for finish quality' },
    { factor: 'Mach Rise Factor', value: getMachRiseFactor(reference.mach), reason: 'Compressibility / transonic allowance at nominal ascent speed' },
    { factor: 'Fineness Ratio', value: geometry.finenessRatio, reason: 'Longer, slimmer rockets tend to carry lower pressure drag' },
  ];

  const low = clamp(finalCd * 0.92, 0.25, 1.0);
  const high = clamp(finalCd * 1.08, 0.25, 1.0);

  return {
    method: 'THEORETICAL',
    cd: finalCd,
    confidence: 'MEDIUM',
    explanation:
      `Professional geometry-based estimate: Cd=${finalCd.toFixed(3)} at a nominal subsonic ascent condition ` +
      `(Mach ${reference.mach.toFixed(2)}, Re ${reference.reynolds.toExponential(2)}). ` +
      `This result is built from a drag budget rather than a single empirical guess.`,
    details: {
      baseCd: finalCd,
      breakdown,
      corrections,
      geometry,
      referenceCondition: reference,
      cdRange: { low, high },
    },
  };
};

export const calibrateCdFromFlightData = async (
  rocket: RocketConfig,
  actualApogeeFt: number,
  actualMassG: number,
  env: Environment,
  baseCd: number = 0.5
): Promise<CdPredictionResult> => {
  const modifiedRocket: RocketConfig = {
    ...rocket,
    manualOverride: {
      ...rocket.manualOverride,
      mass: actualMassG / 1000,
    },
  };

  let lowCd = 0.22;
  let highCd = 1.05;
  let bestCd = clamp(baseCd, lowCd, highCd);
  let bestError = Infinity;
  let iterations = 0;
  const maxIterations = 36;
  const tolerance = 1.0;
  const rodLength = rocket.simulationSettings?.launchRodLength ?? 1.0;

  while (iterations < maxIterations && highCd - lowCd > 0.0008) {
    const testCd = (lowCd + highCd) / 2;
    iterations++;
    const result = await runSimulation({ ...modifiedRocket, cdOverride: testCd }, env, 90, rodLength);
    const simulatedApogeeFt = result.apogee * 3.28084;
    const error = Math.abs(simulatedApogeeFt - actualApogeeFt);

    if (error < bestError) {
      bestError = error;
      bestCd = testCd;
    }

    if (error < tolerance) break;

    if (simulatedApogeeFt > actualApogeeFt) {
      lowCd = testCd;
    } else {
      highCd = testCd;
    }
  }

  const finalResult = await runSimulation({ ...modifiedRocket, cdOverride: bestCd }, env, 90, rodLength);
  const finalApogeeFt = finalResult.apogee * 3.28084;
  const finalError = Math.abs(finalApogeeFt - actualApogeeFt);
  const confidence: 'HIGH' | 'MEDIUM' | 'LOW' =
    finalError < 8 ? 'HIGH' : finalError < 20 ? 'MEDIUM' : 'LOW';

  return {
    method: 'CALIBRATED',
    cd: bestCd,
    confidence,
    explanation:
      `Cd tuned directly against a measured flight. Final match error is ${finalError.toFixed(1)} ft ` +
      `using launch mass ${actualMassG.toFixed(0)} g and the current environment / motor profile.`,
    details: {
      baseCd,
      calibrationError: finalError,
      iterations,
      cdRange: {
        low: clamp(bestCd * 0.96, 0.2, 1.1),
        high: clamp(bestCd * 1.04, 0.2, 1.1),
      },
    },
  };
};

export const estimateCdFromSimilarRockets = (
  rocket: RocketConfig,
  input: CdPredictionInput
): CdPredictionResult => {
  const geometry = extractGeometrySummary(rocket, input);
  const diameterIn = geometry.maxDiameter * 39.3701;
  const slendernessBias = geometry.finenessRatio > 10 ? -0.03 : geometry.finenessRatio < 7 ? 0.03 : 0;
  const finBias = geometry.finCount >= 4 ? 0.015 : 0;
  const empiricalCd = clamp(0.48 + slendernessBias + finBias, 0.38, 0.68);

  return {
    method: 'ESTIMATED',
    cd: empiricalCd,
    confidence: 'LOW',
    explanation:
      `Empirical cross-check from similar amateur rockets of ${diameterIn.toFixed(1)} in diameter. ` +
      `Useful as a sanity bound, but less authoritative than the geometry budget or a real-flight calibration.`,
    details: {
      geometry,
      cdRange: {
        low: clamp(empiricalCd - 0.05, 0.25, 1.0),
        high: clamp(empiricalCd + 0.05, 0.25, 1.0),
      },
    },
  };
};

export const predictCd = async (
  rocket: RocketConfig,
  input: CdPredictionInput
): Promise<CdPredictionResult[]> => {
  const results: CdPredictionResult[] = [];

  results.push(predictCdFromGeometry(rocket, input));

  if (input.actualApogee && input.actualMass && input.environment) {
    const baseCd = rocket.cdOverride || results[0].cd || 0.5;
    results.push(
      await calibrateCdFromFlightData(
        rocket,
        input.actualApogee,
        input.actualMass,
        input.environment,
        baseCd
      )
    );
  }

  results.push(estimateCdFromSimilarRockets(rocket, input));
  return results;
};

export const getRecommendedCd = (results: CdPredictionResult[]): number => {
  const calibrated = results.find((r) => r.method === 'CALIBRATED');
  if (calibrated) return calibrated.cd;
  const theoretical = results.find((r) => r.method === 'THEORETICAL');
  if (theoretical) return theoretical.cd;
  const estimated = results.find((r) => r.method === 'ESTIMATED');
  return estimated?.cd ?? 0.5;
};
