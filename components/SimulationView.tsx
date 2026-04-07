import React, { useState, useEffect, useRef, useMemo } from 'react';
import { RocketConfig, Environment, SimulationResult, SurfaceRoughness, WindLayer } from '../types';
import { runSimulation } from '../services/physics6dofStable';
import { exportCSV, exportJSON } from '../services/dataExporter';
import { optimizeLaunchAngle } from '../services/enhancedCalibration';
import { computeMLCorrection, loadMLModels, getModelInfo, MLCorrectionResult, MLInputFeatures } from '../services/mlPredictor';
import { createDefaultWindProfile, mpsToMph, mphToMps, normalizeWindProfile, sampleWindProfile, syncEnvironmentWindScalars } from '../services/windField';
import Rocket3D from './Rocket3D';
import Rocket3DEnhanced from './Rocket3DEnhanced';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment as ThreeEnvironment, Stars, Sky } from '@react-three/drei';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from 'recharts';

interface Props {
  rocket: RocketConfig;
  env: Environment;
  setEnv: React.Dispatch<React.SetStateAction<Environment>>;
  simResult: SimulationResult | null;
  setSimResult: React.Dispatch<React.SetStateAction<SimulationResult | null>>;
  onUpdateRocket?: (updater: (rocket: RocketConfig) => RocketConfig) => void;
}


type ViewMode = 'config' | 'results' | '3d';

const ROUGHNESS_OPTIONS: { value: SurfaceRoughness; label: string; helper: string; exponent: number }[] = [
  { value: 'water', label: 'Water / Ice', helper: 'Lowest shear, smooth boundary layer', exponent: 0.1 },
  { value: 'open', label: 'Open Field', helper: 'Typical launch site default', exponent: 0.14 },
  { value: 'suburban', label: 'Suburban', helper: 'Trees and low structures increase shear', exponent: 0.22 },
  { value: 'urban', label: 'Urban / Dense', helper: 'Highest shear and turbulence', exponent: 0.33 },
];

const DEFAULT_ADVANCED_LAYERS: WindLayer[] = [
  { altitude: 0, speed: 0, direction: 0, turbulenceIntensity: 0.05 },
  { altitude: 30, speed: 0, direction: 0, turbulenceIntensity: 0.08 },
  { altitude: 100, speed: 0, direction: 0, turbulenceIntensity: 0.12 },
];

const SimulationView: React.FC<Props> = ({ rocket, env, setEnv, simResult, setSimResult, onUpdateRocket }) => {
  const [viewMode, setViewMode] = useState<ViewMode>('config');
  const [isRunning, setIsRunning] = useState(false);
  const [launchAngle, setLaunchAngle] = useState(90);
  const [launchAltitude, setLaunchAltitude] = useState(0);
  const [launchRodLength, setLaunchRodLength] = useState(1.0);
  const [timeStep, setTimeStep] = useState(0.02);
  const [maxSimTime, setMaxSimTime] = useState(30);
  const [cameraFollow, setCameraFollow] = useState(true);
  const [cameraMode, setCameraMode] = useState<'follow' | 'fixed' | 'cinematic' | 'free'>('follow');
  const [useEnhanced3D, setUseEnhanced3D] = useState(true);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizationResult, setOptimizationResult] = useState<any>(null);

  // ML Correction
  const [mlCorrectionEnabled, setMlCorrectionEnabled] = useState(false);
  const [mlCorrectedResult, setMlCorrectedResult] = useState<SimulationResult | null>(null);
  const [mlCorrectionInfo, setMlCorrectionInfo] = useState<MLCorrectionResult | null>(null);
  const [mlModelsAvailable, setMlModelsAvailable] = useState(false);
  const [mlMotorSamples, setMlMotorSamples] = useState(0);

  // 3D Playback
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const controlsRef = useRef<any>(null);
  const normalizedWindProfile = useMemo(
    () => normalizeWindProfile(env.windProfile, env),
    [env]
  );
  const windMode = normalizedWindProfile.mode;
  const sampledWindAtRail = useMemo(
    () => sampleWindProfile({ ...env, windProfile: normalizedWindProfile }, 0, 0),
    [env, normalizedWindProfile]
  );
  const sampledWindAt100m = useMemo(
    () => sampleWindProfile({ ...env, windProfile: normalizedWindProfile }, 100, 5),
    [env, normalizedWindProfile]
  );
  const sampledWindAt300m = useMemo(
    () => sampleWindProfile({ ...env, windProfile: normalizedWindProfile }, 300, 10),
    [env, normalizedWindProfile]
  );
  const windProfilePreview = useMemo(
    () =>
      [0, 30, 60, 100, 150, 200, 300, 400].map((altitude, index) => {
        const sample = sampleWindProfile({ ...env, windProfile: normalizedWindProfile }, altitude, index * 1.5);
        return {
          altitude,
          speedMph: mpsToMph(sample.speed),
          direction: sample.direction,
        };
      }),
    [env, normalizedWindProfile]
  );

  const updateEnvironment = (updater: (prev: Environment) => Environment) => {
    setEnv((prev) => syncEnvironmentWindScalars(updater(prev)));
  };

  const setSimpleWind = (speedMps: number, directionDeg: number) => {
    updateEnvironment((prev) => ({
      ...prev,
      windSpeed: Math.max(0, speedMps),
      windDirection: ((directionDeg % 360) + 360) % 360,
      windProfile: {
        ...createDefaultWindProfile(Math.max(0, speedMps), directionDeg),
        mode: 'constant',
      },
    }));
  };

  const switchWindMode = (mode: 'constant' | 'layered') => {
    updateEnvironment((prev) => {
      const nextProfile = normalizeWindProfile(prev.windProfile, prev);
      if (mode === 'layered') {
        const layers = nextProfile.layers.length >= 3
          ? nextProfile.layers
          : DEFAULT_ADVANCED_LAYERS.map((layer) => ({
              ...layer,
              speed: prev.windSpeed * Math.pow(Math.max(1, layer.altitude) / 10, nextProfile.hellmannExponent),
              direction: prev.windDirection,
            }));
        return {
          ...prev,
          windProfile: {
            ...nextProfile,
            mode,
            layers,
          },
        };
      }

      return {
        ...prev,
        windSpeed: nextProfile.layers[0]?.speed ?? prev.windSpeed,
        windDirection: nextProfile.layers[0]?.direction ?? prev.windDirection,
        windProfile: {
          ...nextProfile,
          mode,
          layers: [
            {
              altitude: 0,
              speed: nextProfile.layers[0]?.speed ?? prev.windSpeed,
              direction: nextProfile.layers[0]?.direction ?? prev.windDirection,
              turbulenceIntensity: nextProfile.layers[0]?.turbulenceIntensity ?? 0.05,
            },
          ],
        },
      };
    });
  };

  const updateWindLayer = (index: number, patch: Partial<WindLayer>) => {
    updateEnvironment((prev) => {
      const profile = normalizeWindProfile(prev.windProfile, prev);
      const layers = profile.layers.map((layer, layerIndex) =>
        layerIndex === index ? { ...layer, ...patch } : layer
      );
      return {
        ...prev,
        windProfile: {
          ...profile,
          layers,
        },
      };
    });
  };

  const addWindLayer = () => {
    updateEnvironment((prev) => {
      const profile = normalizeWindProfile(prev.windProfile, prev);
      const lastLayer = profile.layers[profile.layers.length - 1] ?? { altitude: 0, speed: prev.windSpeed, direction: prev.windDirection, turbulenceIntensity: 0.08 };
      return {
        ...prev,
        windProfile: {
          ...profile,
          layers: [
            ...profile.layers,
            {
              altitude: lastLayer.altitude + 100,
              speed: lastLayer.speed,
              direction: lastLayer.direction,
              turbulenceIntensity: lastLayer.turbulenceIntensity ?? 0.1,
            },
          ],
        },
      };
    });
  };

  const removeWindLayer = (index: number) => {
    updateEnvironment((prev) => {
      const profile = normalizeWindProfile(prev.windProfile, prev);
      if (profile.layers.length <= 2) return prev;
      return {
        ...prev,
        windProfile: {
          ...profile,
          layers: profile.layers.filter((_, layerIndex) => layerIndex !== index),
        },
      };
    });
  };

  const maxPreviewWind = useMemo(
    () => Math.max(1, ...windProfilePreview.map((point) => point.speedMph)),
    [windProfilePreview]
  );

  // Convert simulation data to imperial units for charts
  const convertedData = simResult ? simResult.data.map(point => ({
    ...point,
    altitude: point.altitude * 3.28084, // m to ft
    velocity: point.velocity * 2.23694, // m/s to mph
    range: point.range * 3.28084 // m to ft
  })) : [];

  // Optimize launch angle
  const handleOptimizeAngle = async () => {
    setIsOptimizing(true);
    setTimeout(async () => {
      const result = await optimizeLaunchAngle(rocket, env, launchRodLength, [75, 90], 1.0);
      setOptimizationResult(result);
      setLaunchAngle(result.optimalAngle);
      setIsOptimizing(false);
    }, 100);
  };

  // Run simulation
  const handleRunSimulation = () => {
    setIsRunning(true);

    // Log input parameters for debugging
    console.log('[SIMULATION] ========================================');
    console.log('[SIMULATION] Starting simulation with parameters:');
    console.log('[SIMULATION]   Rocket:', rocket.name);
    console.log('[SIMULATION]   Motor:', rocket.motor.name);
    console.log('[SIMULATION]   Wind Speed:', env.windSpeed.toFixed(2), 'm/s');
    console.log('[SIMULATION]   Wind Direction:', env.windDirection.toFixed(1), '°');
    console.log('[SIMULATION]   Wind Mode:', normalizedWindProfile.mode);
    console.log(
      '[SIMULATION]   Wind Samples:',
      `rail=${mpsToMph(sampledWindAtRail.speed).toFixed(1)}mph @ ${sampledWindAtRail.direction.toFixed(0)}°`,
      `100m=${mpsToMph(sampledWindAt100m.speed).toFixed(1)}mph @ ${sampledWindAt100m.direction.toFixed(0)}°`,
      `300m=${mpsToMph(sampledWindAt300m.speed).toFixed(1)}mph @ ${sampledWindAt300m.direction.toFixed(0)}°`
    );
    console.log('[SIMULATION]   Temperature:', env.temperature.toFixed(1), '°C');
    console.log('[SIMULATION]   Pressure:', env.pressure.toFixed(1), 'hPa');
    console.log('[SIMULATION]   Humidity:', env.humidity.toFixed(1), '%');
    console.log('[SIMULATION]   Launch Angle:', launchAngle.toFixed(1), '°');
    console.log('[SIMULATION]   Rail Length:', launchRodLength.toFixed(2), 'm');
    console.log('[SIMULATION] ========================================');

    setTimeout(async () => {
      // Use 6DOF physics engine (unified system)
      console.log('[SIMULATION] Using 6DOF physics engine');
      const res = await runSimulation(rocket, env, launchAngle, launchRodLength);
      setSimResult(res);

      console.log('[SIMULATION] Result: Apogee =', (res.apogee * 3.28084).toFixed(1), 'ft');

      // ML Correction: if enabled, compute correction and re-run physics
      setMlCorrectedResult(null);
      setMlCorrectionInfo(null);

      if (mlCorrectionEnabled) {
        try {
          // res.calculatedMass is already the full launch mass used by the physics engine.
          const totalMass_g = res.calculatedMass * 1000;
          const input: MLInputFeatures = {
            mass_g: totalMass_g,
            temp_c: env.temperature,
            humidity_percent: env.humidity,
            pressure_hpa: env.pressure,
            motor_mass_g: rocket.motor.totalMass * 1000,
            wind_speed_mph: env.windSpeed / 0.44704,
            motor: rocket.motor.name,
          };

          const currentKDrag = rocket.simulationSettings?.kDrag ?? 1.0;
          const correction = await computeMLCorrection(input, res.apogee * 3.28084, currentKDrag);

          if (correction) {
            setMlCorrectionInfo(correction);

            // Re-run physics with ML-corrected kDrag
            const correctedRocket: RocketConfig = {
              ...rocket,
              simulationSettings: {
                ...rocket.simulationSettings,
                kDrag: correction.correctedKDrag,
              },
            };
            const correctedRes = await runSimulation(correctedRocket, env, launchAngle, launchRodLength);
            setMlCorrectedResult(correctedRes);

            console.log('[SIMULATION] ML-Corrected Apogee =', (correctedRes.apogee * 3.28084).toFixed(1), 'ft');
          }
        } catch (err) {
          console.warn('[SIMULATION] ML correction failed:', err);
        }
      }

      setIsRunning(false);
      setViewMode('results');
      console.log('[SIMULATION] ========================================');
    }, 500);
  };

  // Check ML model availability on mount and when motor changes
  useEffect(() => {
    (async () => {
      const models = await loadMLModels();
      setMlModelsAvailable(!!models);
      if (models) {
        const motorName = rocket.motor.name;
        // Try to match motor name from training data
        const matchedMotor = models.training_info.motors.find(m =>
          motorName.toUpperCase().includes(m.replace(/-\d+[A-Z]*$/, '').toUpperCase()) ||
          m.toUpperCase().includes(motorName.replace(/-\d+[A-Z]*$/, '').toUpperCase())
        );
        setMlMotorSamples(matchedMotor ? (models.training_info.motor_counts[matchedMotor] || 0) : 0);
      }
    })();
  }, [rocket.motor.name]);

  // Handle Playback Loop for 3D view
  useEffect(() => {
    // Auto-fill from rocket simulation settings if available
    if (rocket.simulationSettings) {
      if (rocket.simulationSettings.windSpeed !== undefined) {
        setEnv(prev => syncEnvironmentWindScalars({ ...prev, windSpeed: rocket.simulationSettings!.windSpeed! }));
      }
      if (rocket.simulationSettings.launchRodLength !== undefined) {
        setLaunchRodLength(rocket.simulationSettings.launchRodLength);
      }
    }
  }, [rocket, setEnv]);

  useEffect(() => {
    let handle: number;
    if (isPlaying && simResult) {
      let lastTime = performance.now();
      const loop = (time: number) => {
        const dt = (time - lastTime) / 1000;
        lastTime = time;
        setPlaybackTime(prev => {
          const next = prev + dt * playbackSpeed;
          if (next >= simResult.flightTime + 1) {
            setIsPlaying(false);
            return simResult.flightTime;
          }
          return next;
        });
        handle = requestAnimationFrame(loop);
      };
      handle = requestAnimationFrame(loop);
    }
    return () => cancelAnimationFrame(handle);
  }, [isPlaying, simResult, playbackSpeed]);

  const currentTelemetry = useMemo(() => {
    if (!simResult || simResult.data.length === 0) return undefined;

    const data = simResult.data;
    const nextIndex = data.findIndex((point) => point.time >= playbackTime);
    if (nextIndex <= 0) {
      return data[0];
    }

    if (nextIndex === -1) {
      return data[data.length - 1];
    }

    const p1 = data[nextIndex - 1];
    const p2 = data[nextIndex];
    const dt = Math.max(p2.time - p1.time, 1e-6);
    const t = (playbackTime - p1.time) / dt;
    const lerp = (a?: number, b?: number) => {
      if (typeof a !== 'number' && typeof b !== 'number') return undefined;
      if (typeof a !== 'number') return b;
      if (typeof b !== 'number') return a;
      return a + (b - a) * t;
    };

    return {
      ...p1,
      time: playbackTime,
      altitude: p1.altitude + (p2.altitude - p1.altitude) * t,
      range: p1.range + (p2.range - p1.range) * t,
      velocity: p1.velocity + (p2.velocity - p1.velocity) * t,
      velocityX: p1.velocityX + (p2.velocityX - p1.velocityX) * t,
      velocityY: p1.velocityY + (p2.velocityY - p1.velocityY) * t,
      acceleration: p1.acceleration + (p2.acceleration - p1.acceleration) * t,
      thrust: p1.thrust + (p2.thrust - p1.thrust) * t,
      drag: p1.drag + (p2.drag - p1.drag) * t,
      mass: p1.mass + (p2.mass - p1.mass) * t,
      airDensity: p1.airDensity + (p2.airDensity - p1.airDensity) * t,
      cd: p1.cd + (p2.cd - p1.cd) * t,
      pitch: lerp(p1.pitch, p2.pitch),
      mach: lerp(p1.mach, p2.mach),
      angleOfAttack: lerp(p1.angleOfAttack, p2.angleOfAttack),
      relativeAirspeed: lerp(p1.relativeAirspeed, p2.relativeAirspeed),
      dynamicPressure: lerp(p1.dynamicPressure, p2.dynamicPressure),
      windSpeedAtAltitude: lerp(p1.windSpeedAtAltitude, p2.windSpeedAtAltitude),
      windVelocityX: lerp(p1.windVelocityX, p2.windVelocityX),
      windVelocityY: lerp(p1.windVelocityY, p2.windVelocityY),
      dragCoefficient: lerp(p1.dragCoefficient, p2.dragCoefficient),
      parachuteDeployed: t < 0.5 ? p1.parachuteDeployed : p2.parachuteDeployed,
    };
  }, [playbackTime, simResult]);

  return (
    <div className="flex h-full flex-col bg-[#0a1020] text-slate-100">
      {/* Tab Navigation */}
      <div className="flex border-b border-slate-800 bg-[#0b1220] px-6">
        <button
          onClick={() => setViewMode('config')}
          className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
            viewMode === 'config'
              ? 'border-cyan-400 text-cyan-300'
              : 'border-transparent text-slate-500 hover:text-slate-200'
          }`}
        >
          Configuration
        </button>
        <button
          onClick={() => setViewMode('results')}
          className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
            viewMode === 'results'
              ? 'border-cyan-400 text-cyan-300'
              : 'border-transparent text-slate-500 hover:text-slate-200'
          }`}
          disabled={!simResult}
        >
          Results
        </button>
        <button
          onClick={() => setViewMode('3d')}
          className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
            viewMode === '3d'
              ? 'border-cyan-400 text-cyan-300'
              : 'border-transparent text-slate-500 hover:text-slate-200'
          }`}
          disabled={!simResult}
        >
          3D View
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden">
        {/* Configuration View */}
        {viewMode === 'config' && (
          <div className="h-full overflow-y-auto bg-[#0a1020] p-6">
            <div className="max-w-4xl mx-auto space-y-5">

              {/* Launch Conditions */}
              <div className="rounded-2xl border border-cyan-500/20 bg-[#0b1220] p-5 shadow-[0_24px_80px_rgba(4,10,24,0.45)]">
                <h3 className="mb-4 text-sm font-semibold text-slate-100">Launch Conditions</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="mb-1.5 block font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
                      Launch Angle
                    </label>
                    <input
                      type="number"
                      step="1"
                      className="w-full rounded-lg border border-slate-700 bg-[#020817] px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                      value={launchAngle}
                      onChange={(e) => setLaunchAngle(parseFloat(e.target.value) || 90)}
                    />
                    <div className="mt-1 text-xs text-slate-500">{launchAngle}°</div>
                  </div>

                  <div>
                    <label className="mb-1.5 block font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
                      Launch Altitude
                    </label>
                    <input
                      type="number"
                      step="10"
                      className="w-full rounded-lg border border-slate-700 bg-[#020817] px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                      value={launchAltitude}
                      onChange={(e) => setLaunchAltitude(parseFloat(e.target.value) || 0)}
                    />
                    <div className="mt-1 text-xs text-slate-500">{launchAltitude} m</div>
                  </div>

                  <div>
                    <label className="mb-1.5 block font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
                      Rod Length
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      className="w-full rounded-lg border border-slate-700 bg-[#020817] px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                      value={launchRodLength}
                      onChange={(e) => setLaunchRodLength(parseFloat(e.target.value) || 1.0)}
                    />
                    <div className="mt-1 text-xs text-slate-500">{launchRodLength} m</div>
                  </div>
                </div>
              </div>

              {/* Atmospheric Conditions */}
              <div className="rounded-2xl border border-slate-800 bg-[#0b1220] p-5">
                <h3 className="mb-4 text-sm font-semibold text-slate-100">Atmospheric Conditions</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="mb-1.5 block font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
                      Temperature
                    </label>
                    <input
                      type="number"
                      step="1"
                      className="w-full rounded-lg border border-slate-700 bg-[#020817] px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                      value={env.temperature}
                      onChange={(e) => setEnv(prev => ({ ...prev, temperature: parseFloat(e.target.value) || 15 }))}
                    />
                    <div className="mt-1 text-xs text-slate-500">{env.temperature} °C</div>
                  </div>

                  <div>
                    <label className="mb-1.5 block font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
                      Pressure
                    </label>
                    <input
                      type="number"
                      step="1"
                      className="w-full rounded-lg border border-slate-700 bg-[#020817] px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                      value={env.pressure}
                      onChange={(e) => setEnv(prev => ({ ...prev, pressure: parseFloat(e.target.value) || 1013 }))}
                    />
                    <div className="mt-1 text-xs text-slate-500">{env.pressure} hPa</div>
                  </div>

                  <div>
                    <label className="mb-1.5 block font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
                      Humidity
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      max="100"
                      className="w-full rounded-lg border border-slate-700 bg-[#020817] px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                      value={env.humidity}
                      onChange={(e) => setEnv(prev => ({ ...prev, humidity: parseFloat(e.target.value) || 50 }))}
                    />
                    <div className="mt-1 text-xs text-slate-500">{env.humidity} %</div>
                  </div>

                  <div className="flex flex-col justify-center rounded-lg border border-slate-800 bg-[#0f172a] p-4">
                    <div className="mb-1 font-mono text-xs uppercase tracking-[0.2em] text-slate-500">Air Density</div>
                    <div className="text-xl font-semibold text-slate-100">{env.airDensity.toFixed(4)}</div>
                    <div className="text-xs text-slate-500">kg/m³</div>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-mono text-[11px] uppercase tracking-[0.24em] text-cyan-300/80">Wind Field</div>
                      <div className="mt-1 text-sm font-semibold text-slate-100">
                        {windMode === 'constant' ? 'Constant surface wind with shear/gust modeling' : 'Layered atmospheric wind profile'}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        Ground: {mpsToMph(sampledWindAtRail.speed).toFixed(1)} mph from {sampledWindAtRail.direction.toFixed(0)}°
                        {' · '}
                        100m: {mpsToMph(sampledWindAt100m.speed).toFixed(1)} mph
                        {' · '}
                        300m: {mpsToMph(sampledWindAt300m.speed).toFixed(1)} mph
                      </div>
                    </div>
                    <div className="flex rounded-xl border border-slate-700 bg-[#020817] p-1">
                      <button
                        onClick={() => switchWindMode('constant')}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                          windMode === 'constant'
                            ? 'bg-cyan-500 text-slate-950'
                            : 'text-slate-400 hover:text-slate-100'
                        }`}
                      >
                        Simple
                      </button>
                      <button
                        onClick={() => switchWindMode('layered')}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                          windMode === 'layered'
                            ? 'bg-cyan-500 text-slate-950'
                            : 'text-slate-400 hover:text-slate-100'
                        }`}
                      >
                        Advanced
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 xl:grid-cols-[1.3fr_0.9fr]">
                    <div className="rounded-2xl border border-slate-800 bg-[#07101d] p-4">
                      <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.24em] text-slate-400">
                        Wind Vs Altitude
                      </div>
                      <div className="text-xs text-slate-400">
                        Preview of the wind field the 6DOF solver will sample during ascent and descent.
                      </div>
                      <div className="mt-4 h-56 rounded-xl border border-slate-800 bg-[#020817] p-3">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={windProfilePreview} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis
                              type="number"
                              dataKey="speedMph"
                              domain={[0, Math.ceil(maxPreviewWind + 1)]}
                              tick={{ fontSize: 10, fill: '#94a3b8' }}
                              tickLine={false}
                              axisLine={{ stroke: '#334155' }}
                              label={{ value: 'Wind Speed (mph)', position: 'insideBottom', offset: -4, fill: '#64748b', fontSize: 11 }}
                            />
                            <YAxis
                              type="number"
                              dataKey="altitude"
                              tick={{ fontSize: 10, fill: '#94a3b8' }}
                              tickLine={false}
                              axisLine={{ stroke: '#334155' }}
                              label={{ value: 'Altitude (m)', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11 }}
                            />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#020817', border: '1px solid #334155', borderRadius: '12px', color: '#e2e8f0' }}
                              formatter={(value: any, name: string, entry: any) => {
                                if (name === 'speedMph') return [`${Number(value).toFixed(1)} mph`, 'Wind speed'];
                                return [value, name];
                              }}
                              labelFormatter={(label: any, payload: any) => {
                                const row = payload?.[0]?.payload;
                                return row ? `${row.altitude} m · from ${row.direction.toFixed(0)}°` : `${label}`;
                              }}
                            />
                            <Line
                              type="monotone"
                              dataKey="speedMph"
                              stroke="#22d3ee"
                              strokeWidth={2.5}
                              dot={{ r: 3, strokeWidth: 0, fill: '#67e8f9' }}
                              activeDot={{ r: 5, fill: '#a5f3fc' }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-800 bg-[#07101d] p-4">
                      <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.24em] text-slate-400">
                        How Simple Mode Works
                      </div>
                      <div className="space-y-3 text-xs leading-5 text-slate-400">
                        <p>
                          In <span className="text-slate-200">Simple</span> mode you provide only the surface wind. The solver then grows wind with altitude using a
                          <span className="mx-1 text-cyan-300">Hellmann power-law shear model</span>
                          based on terrain roughness.
                        </p>
                        <div className="rounded-xl border border-slate-800 bg-[#020817] px-3 py-2 font-mono text-[11px] text-slate-300">
                          V(h) = Vref × (h / href)<sup>α</sup>
                        </div>
                        <p>
                          Here <span className="text-slate-200">α = {normalizedWindProfile.hellmannExponent.toFixed(2)}</span>,
                          <span className="ml-1 text-slate-200">href = {normalizedWindProfile.referenceHeight.toFixed(0)} m</span>,
                          and gusts add deterministic speed and direction variation without making runs random.
                        </p>
                        <p>
                          For professional use, switch to <span className="text-slate-200">Advanced</span> mode whenever you have weather balloon, forecast, or field-observer data for multiple altitudes.
                        </p>
                      </div>
                    </div>
                  </div>

                  {windMode === 'constant' ? (
                    <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
                      <div>
                        <label className="mb-1.5 block font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
                          Surface Wind
                        </label>
                        <input
                          type="number"
                          step="any"
                          className="w-full rounded-lg border border-slate-700 bg-[#020817] px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                          value={mpsToMph(env.windSpeed)}
                          onChange={(e) => setSimpleWind(mphToMps(parseFloat(e.target.value) || 0), env.windDirection)}
                        />
                        <div className="mt-1 text-xs text-slate-500">{mpsToMph(env.windSpeed).toFixed(1)} mph</div>
                        <div className="mt-1 text-[11px] leading-4 text-slate-400">Measured ground wind at the launch pad. This is the anchor for the whole simple wind model.</div>
                      </div>

                      <div>
                        <label className="mb-1.5 block font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
                          Surface Direction
                        </label>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          max="360"
                          className="w-full rounded-lg border border-slate-700 bg-[#020817] px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                          value={env.windDirection}
                          onChange={(e) => setSimpleWind(env.windSpeed, parseFloat(e.target.value) || 0)}
                        />
                        <div className="mt-1 text-xs text-slate-500">{env.windDirection.toFixed(0)}° from</div>
                        <div className="mt-1 text-[11px] leading-4 text-slate-400">Direction the wind is coming from, using meteorological convention: 0° = north, 90° = east.</div>
                      </div>

                      <div>
                        <label className="mb-1.5 block font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
                          Terrain Shear
                        </label>
                        <select
                          className="w-full rounded-lg border border-slate-700 bg-[#020817] px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                          value={normalizedWindProfile.surfaceRoughness}
                          onChange={(e) => {
                            const nextRoughness = e.target.value as SurfaceRoughness;
                            const roughnessOption = ROUGHNESS_OPTIONS.find((option) => option.value === nextRoughness);
                            updateEnvironment((prev) => ({
                              ...prev,
                              windProfile: {
                                ...normalizedWindProfile,
                                surfaceRoughness: nextRoughness,
                                hellmannExponent: roughnessOption?.exponent ?? normalizedWindProfile.hellmannExponent,
                              },
                            }));
                          }}
                        >
                          {ROUGHNESS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <div className="mt-1 text-xs text-slate-500">
                          exponent {normalizedWindProfile.hellmannExponent.toFixed(2)}
                        </div>
                        <div className="mt-1 text-[11px] leading-4 text-slate-400">Select how rough the terrain is. Rougher terrain means wind usually increases faster with altitude.</div>
                      </div>

                      <div>
                        <label className="mb-1.5 block font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
                          Gust Intensity
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="0.6"
                          className="w-full rounded-lg border border-slate-700 bg-[#020817] px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                          value={normalizedWindProfile.gusts?.intensity ?? 0.12}
                          onChange={(e) =>
                            updateEnvironment((prev) => ({
                              ...prev,
                              windProfile: {
                                ...normalizedWindProfile,
                                gusts: {
                                  ...(normalizedWindProfile.gusts ?? { enabled: true, intensity: 0.12, frequency: 1.0, directionalVarianceDeg: 6, seed: 17 }),
                                  intensity: parseFloat(e.target.value) || 0,
                                },
                              },
                            }))
                          }
                        />
                        <div className="mt-1 text-xs text-slate-500">fraction of local wind speed</div>
                        <div className="mt-1 text-[11px] leading-4 text-slate-400">Controls short-term wind fluctuation strength. `0.10` means gusts are about 10% of the local base wind.</div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 space-y-4">
                      <div className="grid gap-4 lg:grid-cols-4">
                        <div>
                          <label className="mb-1.5 block font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
                            Surface Roughness
                          </label>
                          <select
                            className="w-full rounded-lg border border-slate-700 bg-[#020817] px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                            value={normalizedWindProfile.surfaceRoughness}
                            onChange={(e) => {
                              const nextRoughness = e.target.value as SurfaceRoughness;
                              const roughnessOption = ROUGHNESS_OPTIONS.find((option) => option.value === nextRoughness);
                              updateEnvironment((prev) => ({
                                ...prev,
                                windProfile: {
                                  ...normalizedWindProfile,
                                  surfaceRoughness: nextRoughness,
                                  hellmannExponent: roughnessOption?.exponent ?? normalizedWindProfile.hellmannExponent,
                                },
                              }));
                            }}
                          >
                            {ROUGHNESS_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <div className="mt-1 text-xs text-slate-500">
                            {ROUGHNESS_OPTIONS.find((option) => option.value === normalizedWindProfile.surfaceRoughness)?.helper}
                          </div>
                          <div className="mt-1 text-[11px] leading-4 text-slate-400">Used as the background terrain model around your explicit wind layers.</div>
                        </div>
                        <div>
                          <label className="mb-1.5 block font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
                            Reference Height
                          </label>
                          <input
                            type="number"
                            step="1"
                            className="w-full rounded-lg border border-slate-700 bg-[#020817] px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                            value={normalizedWindProfile.referenceHeight}
                            onChange={(e) =>
                              updateEnvironment((prev) => ({
                                ...prev,
                                windProfile: {
                                  ...normalizedWindProfile,
                                  referenceHeight: parseFloat(e.target.value) || 10,
                                },
                              }))
                            }
                          />
                          <div className="mt-1 text-xs text-slate-500">m AGL</div>
                          <div className="mt-1 text-[11px] leading-4 text-slate-400">The altitude where your reference wind is defined for shear calculations between sparse layers.</div>
                        </div>
                        <div>
                          <label className="mb-1.5 block font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
                            Shear Exponent
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0.05"
                            max="0.5"
                            className="w-full rounded-lg border border-slate-700 bg-[#020817] px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                            value={normalizedWindProfile.hellmannExponent}
                            onChange={(e) =>
                              updateEnvironment((prev) => ({
                                ...prev,
                                windProfile: {
                                  ...normalizedWindProfile,
                                  hellmannExponent: parseFloat(e.target.value) || 0.14,
                                },
                              }))
                            }
                          />
                          <div className="mt-1 text-xs text-slate-500">controls vertical speed growth</div>
                          <div className="mt-1 text-[11px] leading-4 text-slate-400">Lower values keep winds flatter with altitude; higher values make upper-air winds increase more aggressively.</div>
                        </div>
                        <div>
                          <label className="mb-1.5 block font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
                            Gust Model
                          </label>
                          <button
                            onClick={() =>
                              updateEnvironment((prev) => ({
                                ...prev,
                                windProfile: {
                                  ...normalizedWindProfile,
                                  gusts: {
                                    ...(normalizedWindProfile.gusts ?? { enabled: true, intensity: 0.12, frequency: 1.0, directionalVarianceDeg: 6, seed: 17 }),
                                    enabled: !(normalizedWindProfile.gusts?.enabled ?? true),
                                  },
                                },
                              }))
                            }
                            className={`mt-0.5 inline-flex rounded-lg border px-3 py-2 text-sm font-medium transition ${
                              normalizedWindProfile.gusts?.enabled
                                ? 'border-cyan-400/40 bg-cyan-500/15 text-cyan-200'
                                : 'border-slate-700 bg-[#020817] text-slate-400'
                            }`}
                          >
                            {normalizedWindProfile.gusts?.enabled ? 'Enabled' : 'Disabled'}
                          </button>
                          <div className="mt-1 text-[11px] leading-4 text-slate-400">Adds repeatable gust and veer variation on top of the base layered profile for more realistic flight loads.</div>
                        </div>
                      </div>

                      <div className="overflow-hidden rounded-xl border border-slate-800">
                        <div className="grid grid-cols-[1.1fr_1fr_1fr_1fr_72px] gap-px bg-slate-800 font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400">
                          <div className="bg-[#111827] px-3 py-2">Altitude</div>
                          <div className="bg-[#111827] px-3 py-2">Speed</div>
                          <div className="bg-[#111827] px-3 py-2">Direction</div>
                          <div className="bg-[#111827] px-3 py-2">Turbulence</div>
                          <div className="bg-[#111827] px-3 py-2 text-center">Del</div>
                        </div>
                        {normalizedWindProfile.layers.map((layer, index) => (
                          <div key={`${layer.altitude}-${index}`} className="grid grid-cols-[1.1fr_1fr_1fr_1fr_72px] gap-px bg-slate-800">
                            <div className="bg-[#020817] px-2 py-2">
                              <input
                                type="number"
                                step="1"
                                className="w-full rounded-md border border-slate-700 bg-[#0b1220] px-2 py-1.5 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                                value={layer.altitude}
                                onChange={(e) => updateWindLayer(index, { altitude: parseFloat(e.target.value) || 0 })}
                              />
                            </div>
                            <div className="bg-[#020817] px-2 py-2">
                              <input
                                type="number"
                                step="0.1"
                                className="w-full rounded-md border border-slate-700 bg-[#0b1220] px-2 py-1.5 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                                value={mpsToMph(layer.speed)}
                                onChange={(e) => updateWindLayer(index, { speed: mphToMps(parseFloat(e.target.value) || 0) })}
                              />
                            </div>
                            <div className="bg-[#020817] px-2 py-2">
                              <input
                                type="number"
                                step="1"
                                min="0"
                                max="360"
                                className="w-full rounded-md border border-slate-700 bg-[#0b1220] px-2 py-1.5 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                                value={layer.direction}
                                onChange={(e) => updateWindLayer(index, { direction: parseFloat(e.target.value) || 0 })}
                              />
                            </div>
                            <div className="bg-[#020817] px-2 py-2">
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                max="1"
                                className="w-full rounded-md border border-slate-700 bg-[#0b1220] px-2 py-1.5 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                                value={layer.turbulenceIntensity ?? 0.08}
                                onChange={(e) => updateWindLayer(index, { turbulenceIntensity: parseFloat(e.target.value) || 0 })}
                              />
                            </div>
                            <div className="flex items-center justify-center bg-[#020817] px-2 py-2">
                              <button
                                onClick={() => removeWindLayer(index)}
                                disabled={normalizedWindProfile.layers.length <= 2}
                                className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 transition hover:border-rose-400 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <button
                          onClick={addWindLayer}
                          className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-sm font-medium text-cyan-200 transition hover:bg-cyan-500/15"
                        >
                          Add Wind Layer
                        </button>
                        <div className="text-[11px] leading-4 text-slate-400">
                          Each row defines wind at one altitude. The solver interpolates between layers to create a continuous vertical wind profile.
                        </div>
                        <div className="grid gap-3 text-xs text-slate-400 sm:grid-cols-3">
                          <div>
                            <span className="font-mono uppercase tracking-[0.2em] text-slate-500">Gust</span>
                            <div className="mt-1 text-sm text-slate-200">{((normalizedWindProfile.gusts?.intensity ?? 0) * 100).toFixed(0)}%</div>
                          </div>
                          <div>
                            <span className="font-mono uppercase tracking-[0.2em] text-slate-500">Freq</span>
                            <div className="mt-1 text-sm text-slate-200">{(normalizedWindProfile.gusts?.frequency ?? 1).toFixed(2)}x</div>
                          </div>
                          <div>
                            <span className="font-mono uppercase tracking-[0.2em] text-slate-500">Dir Var</span>
                            <div className="mt-1 text-sm text-slate-200">{(normalizedWindProfile.gusts?.directionalVarianceDeg ?? 0).toFixed(0)}°</div>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-3">
                        <div>
                          <label className="mb-1.5 block font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
                            Gust Intensity
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max="0.8"
                            className="w-full rounded-lg border border-slate-700 bg-[#020817] px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                            value={normalizedWindProfile.gusts?.intensity ?? 0.12}
                            onChange={(e) =>
                              updateEnvironment((prev) => ({
                                ...prev,
                                windProfile: {
                                  ...normalizedWindProfile,
                                  gusts: {
                                    ...(normalizedWindProfile.gusts ?? { enabled: true, intensity: 0.12, frequency: 1.0, directionalVarianceDeg: 6, seed: 17 }),
                                    intensity: parseFloat(e.target.value) || 0,
                                  },
                                },
                              }))
                            }
                          />
                        </div>
                        <div>
                          <label className="mb-1.5 block font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
                            Gust Frequency
                          </label>
                          <input
                            type="number"
                            step="0.1"
                            min="0.1"
                            max="5"
                            className="w-full rounded-lg border border-slate-700 bg-[#020817] px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                            value={normalizedWindProfile.gusts?.frequency ?? 1}
                            onChange={(e) =>
                              updateEnvironment((prev) => ({
                                ...prev,
                                windProfile: {
                                  ...normalizedWindProfile,
                                  gusts: {
                                    ...(normalizedWindProfile.gusts ?? { enabled: true, intensity: 0.12, frequency: 1.0, directionalVarianceDeg: 6, seed: 17 }),
                                    frequency: parseFloat(e.target.value) || 1,
                                  },
                                },
                              }))
                            }
                          />
                        </div>
                        <div>
                          <label className="mb-1.5 block font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
                            Direction Variance
                          </label>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            max="60"
                            className="w-full rounded-lg border border-slate-700 bg-[#020817] px-3 py-2 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none"
                            value={normalizedWindProfile.gusts?.directionalVarianceDeg ?? 6}
                            onChange={(e) =>
                              updateEnvironment((prev) => ({
                                ...prev,
                                windProfile: {
                                  ...normalizedWindProfile,
                                  gusts: {
                                    ...(normalizedWindProfile.gusts ?? { enabled: true, intensity: 0.12, frequency: 1.0, directionalVarianceDeg: 6, seed: 17 }),
                                    directionalVarianceDeg: parseFloat(e.target.value) || 0,
                                  },
                                },
                              }))
                            }
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ML Correction Toggle */}
              <div className="rounded-2xl border border-slate-800 bg-[#0b1220] p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">ML Correction</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {mlModelsAvailable
                        ? `Adjust physics using historical flight data${mlMotorSamples > 0 ? ` (${mlMotorSamples} flights for ${rocket.motor.name})` : ''}`
                        : 'Models not trained yet — run: cd ml && python train.py'}
                    </p>
                  </div>
                  <button
                    onClick={() => setMlCorrectionEnabled(!mlCorrectionEnabled)}
                    disabled={!mlModelsAvailable}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      mlCorrectionEnabled ? 'bg-cyan-500' : 'bg-slate-700'
                    } ${!mlModelsAvailable ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-slate-100 transition-transform ${
                        mlCorrectionEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
                {mlCorrectionEnabled && mlMotorSamples < 4 && mlModelsAvailable && (
                  <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    Low data for this motor ({mlMotorSamples} flights). Correction will use global model — accuracy may be limited.
                  </div>
                )}
              </div>

              {/* Optimization & Run Buttons */}
              <div className="space-y-3 rounded-2xl border border-slate-800 bg-[#0b1220] p-5">
                <button
                  onClick={handleOptimizeAngle}
                  disabled={isOptimizing || isRunning}
                  className="flex w-full items-center justify-center rounded-lg bg-emerald-500 px-6 py-2.5 font-medium text-slate-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                >
                  {isOptimizing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                      <span>Optimizing...</span>
                    </>
                  ) : (
                    <>
                      <span>Find Optimal Angle</span>
                    </>
                  )}
                </button>
                {optimizationResult && (
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm">
                    <div className="mb-1 font-medium text-emerald-200">
                      Optimal: {optimizationResult.optimalAngle}° 
                      ({(optimizationResult.maxApogee * 3.28084).toFixed(1)} ft)
                    </div>
                    <div className="text-xs text-emerald-300/80">
                      Current: {launchAngle}° 
                      {/* Real-time preview disabled — requires async call */}
                    </div>
                  </div>
                )}
                <button
                  onClick={handleRunSimulation}
                  disabled={isRunning || isOptimizing}
                  className="flex w-full items-center justify-center rounded-lg bg-cyan-500 px-6 py-3 font-medium text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                >
                  {isRunning ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                      <span>Running...</span>
                    </>
                  ) : (
                    <>
                      <span>Run Simulation</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Results View */}
        {viewMode === 'results' && simResult && (
          <div className="h-full overflow-y-auto bg-[#0a1020] p-6 text-slate-100">
            <div className="max-w-7xl mx-auto space-y-5">

              {/* Export Buttons */}
              <div className="flex items-center justify-end gap-2">
                <span className="mr-1 text-xs text-slate-500">Export flight data:</span>
                <button
                  onClick={() => exportCSV(simResult, rocket, env)}
                  className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#020817] px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-cyan-500/30 hover:text-cyan-200"
                  title="Download flight data as CSV"
                >
                  <i className="fas fa-file-csv text-green-600"></i>
                  CSV
                </button>
                <button
                  onClick={() => exportJSON(simResult, rocket, env)}
                  className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#020817] px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-cyan-500/30 hover:text-cyan-200"
                  title="Download flight data as JSON"
                >
                  <i className="fas fa-file-code text-blue-600"></i>
                  JSON
                </button>
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-4 gap-4">
                <div className="rounded-lg border border-slate-800 bg-[#0b1220] p-4">
                  <div className="mb-1 text-xs font-medium text-slate-500">Max Altitude</div>
                  <div className="flex items-baseline">
                    <span className="text-2xl font-semibold text-slate-100">{(simResult.apogee * 3.28084).toFixed(1)}</span>
                    <span className="ml-1 text-sm text-slate-500">ft</span>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#0b1220] p-4">
                  <div className="mb-1 text-xs font-medium text-slate-500">Max Velocity</div>
                  <div className="flex items-baseline">
                    <span className="text-2xl font-semibold text-slate-100">{(simResult.maxVelocity * 2.23694).toFixed(1)}</span>
                    <span className="ml-1 text-sm text-slate-500">mph</span>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#0b1220] p-4">
                  <div className="mb-1 text-xs font-medium text-slate-500">Flight Time</div>
                  <div className="flex items-baseline">
                    <span className="text-2xl font-semibold text-slate-100">{simResult.flightTime.toFixed(1)}</span>
                    <span className="ml-1 text-sm text-slate-500">s</span>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#0b1220] p-4">
                  <div className="mb-1 text-xs font-medium text-slate-500">Launch Mass</div>
                  <div className="flex items-baseline">
                    <span className="text-2xl font-semibold text-slate-100">{(simResult.calculatedMass * 1000).toFixed(1)}</span>
                    <span className="ml-1 text-sm text-slate-500">g</span>
                  </div>
                </div>

              </div>

              <div className="rounded-2xl border border-slate-800 bg-[#0b1220] p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-cyan-300/80">Wind Field Used By Physics</div>
                    <div className="mt-1 text-sm font-semibold text-slate-100">
                      {windMode === 'layered' ? 'Layered profile with deterministic gust model' : 'Surface wind with terrain shear and deterministic gust model'}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      This run used the configured wind field directly inside the 6DOF solver for relative airspeed, angle of attack, drift, and recovery descent.
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-700 bg-[#020817] px-3 py-2 text-right">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Profile</div>
                    <div className="mt-1 text-sm font-semibold text-slate-100">{windMode === 'layered' ? `${normalizedWindProfile.layers.length} layers` : '1 reference layer'}</div>
                  </div>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-4">
                  <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
                    <div className="text-xs font-medium text-slate-500">Ground Wind</div>
                    <div className="mt-1 text-lg font-semibold text-slate-100">{mpsToMph(sampledWindAtRail.speed).toFixed(1)} mph</div>
                    <div className="text-xs text-slate-400">from {sampledWindAtRail.direction.toFixed(0)}°</div>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
                    <div className="text-xs font-medium text-slate-500">100m AGL</div>
                    <div className="mt-1 text-lg font-semibold text-slate-100">{mpsToMph(sampledWindAt100m.speed).toFixed(1)} mph</div>
                    <div className="text-xs text-slate-400">from {sampledWindAt100m.direction.toFixed(0)}°</div>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
                    <div className="text-xs font-medium text-slate-500">300m AGL</div>
                    <div className="mt-1 text-lg font-semibold text-slate-100">{mpsToMph(sampledWindAt300m.speed).toFixed(1)} mph</div>
                    <div className="text-xs text-slate-400">from {sampledWindAt300m.direction.toFixed(0)}°</div>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-[#0f172a] p-4">
                    <div className="text-xs font-medium text-slate-500">Gust Envelope</div>
                    <div className="mt-1 text-lg font-semibold text-slate-100">
                      {(((normalizedWindProfile.gusts?.intensity ?? 0) || 0) * 100).toFixed(0)}%
                    </div>
                    <div className="text-xs text-slate-400">
                      dir var {(normalizedWindProfile.gusts?.directionalVarianceDeg ?? 0).toFixed(0)}°
                    </div>
                  </div>
                </div>
              </div>

              {/* Charts */}
              <div className="grid grid-cols-2 gap-5">
                <div className="rounded-lg border border-slate-800 bg-[#0b1220] p-5">
                  <h3 className="mb-4 text-sm font-semibold text-slate-100">Altitude (ft)</h3>
                  <div style={{ height: '300px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={convertedData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorAltitude" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.1} />
                            <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                        <XAxis
                          dataKey="time"
                          tick={{ fontSize: 10, fill: '#9ca3af' }}
                          tickLine={false}
                          axisLine={{ stroke: '#e5e7eb' }}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: '#9ca3af' }}
                          tickLine={false}
                          axisLine={{ stroke: '#e5e7eb' }}
                          width={40}
                        />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '4px', color: '#1f2937', fontSize: '12px' }}
                          formatter={(value: number) => [`${value.toFixed(1)} ft`, 'Physics']}
                          labelFormatter={(label) => `Time: ${label}s`}
                        />
                        <Area type="monotone" dataKey="altitude" name="Physics" stroke="#4f46e5" strokeWidth={2} fill="url(#colorAltitude)" activeDot={{ r: 4, fill: '#4f46e5' }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#0b1220] p-5">
                  <h3 className="mb-4 text-sm font-semibold text-slate-100">
                    Velocity (mph)
                  </h3>
                  <div style={{ height: '300px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={convertedData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorVelocity" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#d97706" stopOpacity={0.1} />
                            <stop offset="95%" stopColor="#d97706" stopOpacity={0.0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                        <XAxis
                          dataKey="time"
                          tick={{ fontSize: 10, fill: '#9ca3af' }}
                          tickLine={false}
                          axisLine={{ stroke: '#e5e7eb' }}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: '#9ca3af' }}
                          tickLine={false}
                          axisLine={{ stroke: '#e5e7eb' }}
                          width={40}
                        />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '4px', color: '#1f2937', fontSize: '12px' }}
                          formatter={(value: number) => [`${value.toFixed(1)} mph`, 'Velocity']}
                          labelFormatter={(label) => `Time: ${label}s`}
                        />
                        <Area type="monotone" dataKey="velocity" stroke="#d97706" strokeWidth={2} fill="url(#colorVelocity)" activeDot={{ r: 4, fill: '#d97706' }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#0b1220] p-5">
                  <h3 className="mb-4 text-sm font-semibold text-slate-100">
                    2D Trajectory
                  </h3>
                  <div style={{ height: '300px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={convertedData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                        <XAxis
                          dataKey="range"
                          type="number"
                          tick={{ fontSize: 10, fill: '#9ca3af' }}
                          tickLine={false}
                          axisLine={{ stroke: '#e5e7eb' }}
                          label={{ value: 'Range (m)', position: 'insideBottom', offset: -5, fontSize: 10, fill: '#9ca3af' }}
                        />
                        <YAxis
                          dataKey="altitude"
                          tick={{ fontSize: 10, fill: '#9ca3af' }}
                          tickLine={false}
                          axisLine={{ stroke: '#e5e7eb' }}
                          width={40}
                          label={{ value: 'Altitude (ft)', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#9ca3af' }}
                        />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '4px', color: '#1f2937', fontSize: '12px' }}
                          formatter={(value: number) => [`${value.toFixed(1)} ft`, 'Altitude']}
                          labelFormatter={(value) => `Range: ${Number(value).toFixed(1)} ft`}
                        />
                        <Line type="monotone" dataKey="altitude" stroke="#10b981" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-[#0b1220] p-5">
                  <h3 className="mb-4 text-sm font-semibold text-slate-100">
                    Aerodynamics
                  </h3>
                  <div style={{ height: '300px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={convertedData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                        <XAxis
                          dataKey="time"
                          tick={{ fontSize: 10, fill: '#9ca3af' }}
                          tickLine={false}
                          axisLine={{ stroke: '#e5e7eb' }}
                        />
                        <YAxis
                          yAxisId="left"
                          tick={{ fontSize: 10, fill: '#9ca3af' }}
                          tickLine={false}
                          axisLine={{ stroke: '#e5e7eb' }}
                          width={40}
                        />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          tick={{ fontSize: 10, fill: '#9ca3af' }}
                          tickLine={false}
                          axisLine={{ stroke: '#e5e7eb' }}
                          width={40}
                        />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '4px', color: '#1f2937', fontSize: '12px' }}
                          formatter={(value: number, name: string) => {
                            if (name === 'Drag (N)') return [`${value.toFixed(2)} N`, name];
                            if (name === 'Density (kg/m³)') return [`${value.toFixed(4)} kg/m³`, name];
                            if (name === 'Cd') return [value.toFixed(3), name];
                            return [value.toFixed(2), name];
                          }}
                          labelFormatter={(label) => `Time: ${label}s`}
                        />
                        <Legend wrapperStyle={{ paddingTop: '10px', fontSize: '12px' }} />
                        <Line yAxisId="left" type="monotone" dataKey="drag" stroke="#e11d48" strokeWidth={2} dot={false} name="Drag (N)" />
                        <Line yAxisId="right" type="monotone" dataKey="airDensity" stroke="#0ea5e9" strokeWidth={2} dot={false} name="Density (kg/m³)" />
                        <Line yAxisId="right" type="monotone" dataKey="cd" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Cd" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-[#0b1220] p-5">
                <h3 className="mb-4 text-sm font-semibold text-slate-100">
                  Multi-Parameter Analysis
                </h3>
                <div style={{ height: '300px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={convertedData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis
                        dataKey="time"
                        tick={{ fontSize: 10, fill: '#9ca3af' }}
                        tickLine={false}
                        axisLine={{ stroke: '#e5e7eb' }}
                      />
                      <YAxis
                        yAxisId="left"
                        tick={{ fontSize: 10, fill: '#9ca3af' }}
                        tickLine={false}
                        axisLine={{ stroke: '#e5e7eb' }}
                        width={40}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 10, fill: '#9ca3af' }}
                        tickLine={false}
                        axisLine={{ stroke: '#e5e7eb' }}
                        width={40}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '4px', color: '#1f2937', fontSize: '12px' }}
                        formatter={(value: number, name: string) => {
                          if (name === 'Thrust (N)' || name === 'Drag (N)') return [`${value.toFixed(2)} N`, name];
                          if (name === 'Acc (m/s²)') return [`${value.toFixed(2)} m/s²`, name];
                          return [value.toFixed(2), name];
                        }}
                        labelFormatter={(label) => `Time: ${label}s`}
                      />
                      <Legend wrapperStyle={{ paddingTop: '10px', fontSize: '12px' }} />
                      <Line yAxisId="left" type="monotone" dataKey="thrust" stroke="#e11d48" strokeWidth={2} dot={false} name="Thrust (N)" />
                      <Line yAxisId="left" type="monotone" dataKey="drag" stroke="#0ea5e9" strokeWidth={2} dot={false} name="Drag (N)" />
                      <Line yAxisId="right" type="monotone" dataKey="acceleration" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Acc (m/s²)" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 3D View */}
        {viewMode === '3d' && simResult && (
          <div className="h-full relative bg-slate-900">
            <Canvas shadows camera={{ position: [8, 3, 8], fov: 60 }}>
              <Sky sunPosition={[100, 20, 100]} turbidity={0.1} rayleigh={0.5} />
              <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />


              {useEnhanced3D ? (
                <Rocket3DEnhanced
                  config={rocket}
                  simulationData={simResult.data}
                  isPlaying={isPlaying}
                  playbackTime={playbackTime}
                  cameraFollow={cameraFollow}
                  controlsRef={controlsRef}
                  cameraMode={cameraMode}
                />
              ) : (
                <Rocket3D
                  config={rocket}
                  simulationData={simResult.data}
                  isPlaying={isPlaying}
                  playbackTime={playbackTime}
                  cameraFollow={cameraFollow}
                  controlsRef={controlsRef}
                />
              )}


              <OrbitControls
                ref={controlsRef}
                makeDefault
                minDistance={2}
                maxDistance={100}
                enableDamping
                dampingFactor={0.05}
              />
              <ThreeEnvironment preset="city" />
            </Canvas>

            {/* Camera Mode Selector */}
            <div className="absolute top-4 left-4 bg-slate-900/90 text-white px-3 py-2 rounded-lg border border-white/10">
              <div className="flex items-center space-x-2 mb-2">
                <i className="fas fa-camera text-xs text-slate-400"></i>
                <span className="text-xs font-semibold text-slate-200">Camera Mode</span>
              </div>
              <div className="flex gap-1">
                {(['follow', 'cinematic', 'free'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setCameraMode(mode)}
                    className={`px-2 py-1 text-[10px] rounded ${cameraMode === mode
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                      }`}
                    title={mode.charAt(0).toUpperCase() + mode.slice(1)}
                  >
                    {mode === 'follow' && <i className="fas fa-crosshairs"></i>}
                    {mode === 'cinematic' && <i className="fas fa-film"></i>}
                    {mode === 'free' && <i className="fas fa-hand-paper"></i>}
                  </button>
                ))}
              </div>
            </div>

            {/* Flight Status Indicator */}
            <div className="absolute top-20 left-4 bg-slate-900/90 text-white px-4 py-2 rounded-lg border border-white/10">
              <div className="flex items-center space-x-3">
                <div className={`w-2 h-2 rounded-full animate-pulse ${currentTelemetry && currentTelemetry.thrust > 0 ? 'bg-green-500' :
                    currentTelemetry?.parachuteDeployed ? 'bg-amber-400' :
                    currentTelemetry && currentTelemetry.velocity > 0 ? 'bg-blue-500' :
                      currentTelemetry && currentTelemetry.velocity < -5 ? 'bg-orange-500' : 'bg-gray-400'
                  }`}></div>
                <span className="text-xs font-medium tracking-wide text-slate-200">
                  {currentTelemetry && currentTelemetry.thrust > 0 ? '🚀 THRUSTING' :
                    currentTelemetry?.parachuteDeployed ? '🌬️ UNDER CANOPY' :
                    currentTelemetry && currentTelemetry.velocity > 0 ? '⬆️ ASCENT' :
                      currentTelemetry && currentTelemetry.velocity < -5 ? '🪂 DESCENT' : '⬇️ FREEFALL'}
                </span>
              </div>
            </div>

            {/* Telemetry Overlay - Enhanced Design */}
            <div className="absolute top-32 left-4 bg-slate-900/90 text-white p-4 rounded-lg border border-white/10 w-72 shadow-xl">
              <div className="flex items-center justify-between mb-4 border-b border-white/10 pb-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">Telemetry</h3>
                <div className="flex items-center space-x-1">
                  <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></div>
                  <span className="text-[10px] text-slate-400">LIVE</span>
                </div>
              </div>

              <div className="space-y-3 font-mono">
                {/* Altitude with progress bar */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="flex items-center text-xs uppercase text-slate-300">
                      <i className="fas fa-arrow-up mr-1"></i>Altitude
                    </span>
                    <div className="text-right">
                      <span className="font-bold text-white text-sm">{((currentTelemetry?.altitude || 0) * 3.28084).toFixed(1)}</span>
                      <span className="ml-1 text-xs text-slate-500">ft</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-100"
                      style={{ width: `${Math.min((currentTelemetry?.altitude || 0) / simResult.apogee * 100, 100)}%` }}
                    ></div>
                  </div>
                </div>

                {/* Velocity */}
                <div className="flex justify-between items-center">
                  <span className="flex items-center text-xs uppercase text-slate-300">
                    <i className="fas fa-tachometer-alt mr-1"></i>Velocity
                  </span>
                  <div className="text-right">
                    <span className="font-bold text-white text-sm">{((currentTelemetry?.velocity || 0) * 2.23694).toFixed(1)}</span>
                    <span className="ml-1 text-xs text-slate-500">mph</span>
                  </div>
                </div>

                {/* Acceleration */}
                <div className="flex justify-between items-center">
                  <span className="flex items-center text-xs uppercase text-slate-300">
                    <i className="fas fa-rocket mr-1"></i>Acceleration
                  </span>
                  <div className="text-right">
                    <span className={`font-bold text-sm ${(currentTelemetry?.acceleration || 0) > 0 ? 'text-green-400' :
                        (currentTelemetry?.acceleration || 0) < -5 ? 'text-red-400' : 'text-white'
                      }`}>
                      {(currentTelemetry?.acceleration || 0).toFixed(1)}
                    </span>
                    <span className="ml-1 text-xs text-slate-500">m/s²</span>
                  </div>
                </div>

                {/* Thrust */}
                <div className="flex justify-between items-center">
                  <span className="flex items-center text-xs uppercase text-slate-300">
                    <i className="fas fa-fire mr-1"></i>Thrust
                  </span>
                  <div className="text-right">
                    <span className={`font-bold text-sm ${(currentTelemetry?.thrust || 0) > 0 ? 'text-orange-400' : 'text-slate-500'
                      }`}>
                      {(currentTelemetry?.thrust || 0).toFixed(0)}
                    </span>
                    <span className="ml-1 text-xs text-slate-500">N</span>
                  </div>
                </div>

                {/* Drag */}
                <div className="flex justify-between items-center">
                  <span className="flex items-center text-xs uppercase text-slate-300">
                    <i className="fas fa-wind mr-1"></i>Drag
                  </span>
                  <div className="text-right">
                    <span className="font-bold text-white text-sm">{(currentTelemetry?.drag || 0).toFixed(1)}</span>
                    <span className="ml-1 text-xs text-slate-500">N</span>
                  </div>
                </div>

                {/* Mach Number */}
                {currentTelemetry && (
                  <div className="flex justify-between items-center">
                    <span className="flex items-center text-xs uppercase text-slate-300">
                      <i className="fas fa-gauge-high mr-1"></i>Mach
                    </span>
                    <div className="text-right">
                      <span className="font-bold text-white text-sm">
                        {(currentTelemetry.mach || 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Relative airspeed */}
                {currentTelemetry && (
                  <div className="flex justify-between items-center">
                    <span className="flex items-center text-xs uppercase text-slate-300">
                      <i className="fas fa-feather-pointed mr-1"></i>Airspeed
                    </span>
                    <div className="text-right">
                      <span className="font-bold text-white text-sm">
                        {((currentTelemetry.relativeAirspeed || currentTelemetry.velocity || 0) * 2.23694).toFixed(1)}
                      </span>
                      <span className="ml-1 text-xs text-slate-500">mph</span>
                    </div>
                  </div>
                )}

                {/* Wind at altitude */}
                {currentTelemetry && (
                  <div className="flex justify-between items-center">
                    <span className="flex items-center text-xs uppercase text-slate-300">
                      <i className="fas fa-wind mr-1"></i>Wind
                    </span>
                    <div className="text-right">
                      <span className="font-bold text-cyan-300 text-sm">
                        {((currentTelemetry.windSpeedAtAltitude ?? env.windSpeed) * 2.23694).toFixed(1)}
                      </span>
                      <span className="ml-1 text-xs text-slate-500">mph</span>
                    </div>
                  </div>
                )}

                {/* Angle of attack */}
                {currentTelemetry && (
                  <div className="flex justify-between items-center">
                    <span className="flex items-center text-xs uppercase text-slate-300">
                      <i className="fas fa-compass-drafting mr-1"></i>AoA
                    </span>
                    <div className="text-right">
                      <span className="font-bold text-white text-sm">
                        {(currentTelemetry.angleOfAttack || 0).toFixed(1)}
                      </span>
                      <span className="ml-1 text-xs text-slate-500">deg</span>
                    </div>
                  </div>
                )}

                {/* Dynamic pressure */}
                {currentTelemetry && (
                  <div className="flex justify-between items-center">
                    <span className="flex items-center text-xs uppercase text-slate-300">
                      <i className="fas fa-wave-square mr-1"></i>Q
                    </span>
                    <div className="text-right">
                      <span className="font-bold text-white text-sm">
                        {((currentTelemetry.dynamicPressure || 0) / 1000).toFixed(2)}
                      </span>
                      <span className="ml-1 text-xs text-slate-500">kPa</span>
                    </div>
                  </div>
                )}

                {/* Drag coefficient */}
                {currentTelemetry && (
                  <div className="flex justify-between items-center">
                    <span className="flex items-center text-xs uppercase text-slate-300">
                      <i className="fas fa-circle-notch mr-1"></i>Cd
                    </span>
                    <div className="text-right">
                      <span className="font-bold text-white text-sm">
                        {(currentTelemetry.dragCoefficient ?? currentTelemetry.cd ?? 0).toFixed(3)}
                      </span>
                    </div>
                  </div>
                )}

                <div className="border-t border-white/10 pt-2 mt-2">
                  <div className="flex justify-between items-center">
                    <span className="flex items-center text-xs uppercase text-slate-300">
                      <i className="fas fa-clock mr-1"></i>Time
                    </span>
                    <div className="font-bold text-blue-400 text-sm">{playbackTime.toFixed(2)}s</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Side Key Events Timeline */}
            <div className="absolute top-4 right-4 bg-slate-900/90 text-white p-4 rounded-lg border border-white/10 w-56 shadow-xl">
              <h3 className="mb-3 border-b border-white/10 pb-2 text-xs font-bold uppercase tracking-wider text-slate-200">Events</h3>
              <div className="space-y-2 text-[10px]">
                {(() => {
                  // Calculate event times from actual simulation data
                  const launchTime = 0;

                  // Max Q: Maximum dynamic pressure (q = 0.5 * rho * v^2)
                  // Find the point with maximum q
                  let maxQ = 0;
                  let maxQTime = 0;
                  simResult.data.forEach(point => {
                    const airspeed = point.relativeAirspeed ?? point.velocity;
                    const q = point.dynamicPressure ?? (0.5 * point.airDensity * airspeed * airspeed);
                    if (q > maxQ) {
                      maxQ = q;
                      maxQTime = point.time;
                    }
                  });

                  // MECO: Main Engine Cut Off - when thrust drops to near zero after burn
                  let mecoTime = 0;
                  for (let i = 1; i < simResult.data.length; i++) {
                    const prev = simResult.data[i - 1];
                    const curr = simResult.data[i];
                    if (prev.thrust > 5 && curr.thrust <= 0.5 && curr.time > 0.1) {
                      mecoTime = curr.time;
                      break;
                    }
                  }

                  // Apogee: Maximum altitude
                  let apogeeTime = 0;
                  let maxAltitude = 0;
                  simResult.data.forEach(point => {
                    if (point.altitude > maxAltitude) {
                      maxAltitude = point.altitude;
                      apogeeTime = point.time;
                    }
                  });

                  // Parachute: When velocity becomes negative after apogee
                  let parachuteTime = apogeeTime;
                  for (let i = simResult.data.findIndex(p => p.time >= apogeeTime); i < simResult.data.length; i++) {
                    const point = simResult.data[i];
                    if ((point.parachuteDeployed || point.velocityY < -1.0) && point.time > apogeeTime) {
                      parachuteTime = point.time;
                      break;
                    }
                  }

                  // Touchdown: When altitude returns to near zero
                  let touchdownTime = simResult.flightTime;
                  for (let i = simResult.data.length - 1; i >= 0; i--) {
                    const point = simResult.data[i];
                    if (point.altitude <= 0.1 && point.time > apogeeTime) {
                      touchdownTime = point.time;
                      break;
                    }
                  }

                  return (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center text-slate-300">
                          <i className="fas fa-rocket mr-1 text-xs"></i>Launch
                        </span>
                        <span className="font-mono text-slate-300">T+{launchTime.toFixed(1)}s</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center text-slate-300">
                          <i className="fas fa-gauge-high mr-1 text-xs"></i>Max Q
                        </span>
                        <span className="font-mono text-slate-300">T+{maxQTime.toFixed(1)}s</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center text-slate-300">
                          <i className="fas fa-power-off mr-1 text-xs"></i>MECO
                        </span>
                        <span className="font-mono text-slate-300">T+{mecoTime.toFixed(1)}s</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center text-slate-300">
                          <i className="fas fa-arrow-up mr-1 text-xs"></i>Apogee
                        </span>
                        <span className="font-mono text-blue-400">T+{apogeeTime.toFixed(1)}s</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center text-slate-300">
                          <i className="fas fa-parachute-box mr-1 text-xs"></i>Parachute
                        </span>
                        <span className="font-mono text-orange-400">T+{parachuteTime.toFixed(1)}s</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center text-slate-300">
                          <i className="fas fa-landing mr-1 text-xs"></i>Touchdown
                        </span>
                        <span className="font-mono text-slate-300">T+{touchdownTime.toFixed(1)}s</span>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Enhanced Playback Controls */}
            <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 bg-slate-900/90 text-white px-6 py-3 rounded-full border border-white/10 shadow-xl">
              <div className="flex items-center space-x-6">
                <button
                  onClick={() => {
                    setPlaybackTime(0);
                    setIsPlaying(true);
                  }}
                  className="text-slate-400 transition-colors hover:text-white"
                  title="Restart"
                >
                  <i className="fas fa-undo text-sm"></i>
                </button>

                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-500 text-slate-950 transition-colors hover:bg-cyan-400"
                >
                  <i className={`fas ${isPlaying ? 'fa-pause' : 'fa-play ml-1'}`}></i>
                </button>

                <div className="h-8 w-px bg-white/20"></div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setPlaybackSpeed(0.5)}
                    className={`rounded px-2 py-1 text-xs ${playbackSpeed === 0.5 ? 'bg-white/20 text-white' : 'text-slate-400 hover:text-white'}`}
                  >
                    0.5x
                  </button>
                  <button
                    onClick={() => setPlaybackSpeed(1.0)}
                    className={`rounded px-2 py-1 text-xs ${playbackSpeed === 1.0 ? 'bg-white/20 text-white' : 'text-slate-400 hover:text-white'}`}
                  >
                    1x
                  </button>
                  <button
                    onClick={() => setPlaybackSpeed(2.0)}
                    className={`rounded px-2 py-1 text-xs ${playbackSpeed === 2.0 ? 'bg-white/20 text-white' : 'text-slate-400 hover:text-white'}`}
                  >
                    2x
                  </button>
                </div>

                <div className="h-8 w-px bg-white/20"></div>

                <button
                  onClick={() => setCameraFollow(!cameraFollow)}
                  className={`text-sm ${cameraFollow ? 'text-cyan-300' : 'text-slate-400 hover:text-white'}`}
                  title="Camera Follow"
                >
                  <i className={`fas ${cameraFollow ? 'fa-video' : 'fa-video-slash'}`}></i>
                </button>

                <div className="min-w-[80px] text-right font-mono text-xs text-slate-400">
                  {playbackTime.toFixed(1)}s / {simResult.flightTime.toFixed(1)}s
                </div>
              </div>

              {/* Minimal Progress Bar */}
              <div className="absolute bottom-0 left-0 w-full h-1 bg-white/10 overflow-hidden rounded-b-full">
                <div
                  className="h-full bg-blue-500 transition-all duration-100"
                  style={{ width: `${(playbackTime / simResult.flightTime) * 100}%` }}
                ></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SimulationView;
