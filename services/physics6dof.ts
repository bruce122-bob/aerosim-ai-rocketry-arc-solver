/**
 * Compatibility facade for legacy 6DOF callers.
 *
 * The project historically exposed several physics engines through this module.
 * We now converge all active callers onto the stable 6DOF engine while keeping
 * the older API surface available for calibration and analysis tools.
 */

import { Environment, RocketConfig, SimulationResult } from '../types';
import { runSimulation as runStableSimulation } from './physics6dofStable';

export enum LogLevel {
  SILENT = 0,
  ERROR = 1,
  WARN = 2,
  INFO = 3,
  DEBUG = 4,
}

let currentLogLevel = LogLevel.INFO;

export const setLogLevel = (level: LogLevel): void => {
  currentLogLevel = level;
};

export const physicsLog = (level: LogLevel, ...args: any[]): void => {
  if (level > currentLogLevel) return;
  if (level === LogLevel.ERROR) console.error(...args);
  else if (level === LogLevel.WARN) console.warn(...args);
  else console.log(...args);
};

export interface PhysicsConfig {
  k_thrust?: number;
  k_drag?: number;
  cdMultiplier?: number;
  enableWind?: boolean;
  enableWindShear?: boolean;
  enableHumidity?: boolean;
  enableTemperatureCorrection?: boolean;
}

export const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = {
  k_thrust: 1.0,
  k_drag: 1.0,
  cdMultiplier: 1.0,
  enableWind: true,
  enableWindShear: true,
  enableHumidity: true,
  enableTemperatureCorrection: true,
};

export interface FlightDataPoint {
  time: number;
  altitude: number;
}

export interface CalibrationResult {
  kThrust: number;
  kDrag: number;
  initialRMSE: number;
  finalRMSE: number;
  improvement: number;
  iterations: number;
  convergence: boolean;
}

export interface MonteCarloConfig {
  runs?: number;
  kThrustStdDev?: number;
  kDragStdDev?: number;
  launchAngleStdDev?: number;
  railLengthStdDev?: number;
}

export interface MonteCarloResult {
  nominal: SimulationResult;
  runs: SimulationResult[];
}

const normalizeFlightData = (flightData: FlightDataPoint[]): FlightDataPoint[] => {
  if (flightData.length === 0) return [];
  const maxAlt = Math.max(...flightData.map(point => point.altitude));
  const isFeet = maxAlt > 400;
  return flightData.map(point => ({
    time: point.time,
    altitude: isFeet ? point.altitude / 3.28084 : point.altitude,
  }));
};

const interpolateSimAltitude = (result: SimulationResult, time: number): number => {
  if (result.data.length === 0) return 0;
  if (time <= result.data[0].time) return result.data[0].altitude;

  for (let i = 1; i < result.data.length; i++) {
    const prev = result.data[i - 1];
    const next = result.data[i];
    if (time <= next.time) {
      const dt = next.time - prev.time;
      if (dt <= 0) return next.altitude;
      const t = (time - prev.time) / dt;
      return prev.altitude + (next.altitude - prev.altitude) * t;
    }
  }

  return result.data[result.data.length - 1].altitude;
};

const calculateTrajectoryRmse = (result: SimulationResult, flightData: FlightDataPoint[]): number => {
  if (flightData.length === 0) return 0;

  const simulatedApogee = result.apogee;
  const actualApogee = Math.max(...flightData.map(point => point.altitude));
  const apogeeErrorSq = Math.pow(simulatedApogee - actualApogee, 2) * 10;

  let errorSum = apogeeErrorSq;
  let sampleCount = 10;

  for (const point of flightData) {
    const simulatedAltitude = interpolateSimAltitude(result, point.time);
    errorSum += Math.pow(simulatedAltitude - point.altitude, 2);
    sampleCount += 1;
  }

  return Math.sqrt(errorSum / sampleCount);
};

const applyPhysicsConfig = (rocket: RocketConfig, config?: PhysicsConfig): RocketConfig => {
  const resolved = { ...DEFAULT_PHYSICS_CONFIG, ...config };
  const baseCd = rocket.cdOverride ?? 0.5;
  const cdMultiplier = resolved.cdMultiplier ?? 1.0;

  return {
    ...rocket,
    cdOverride: baseCd * cdMultiplier,
    simulationSettings: {
      ...rocket.simulationSettings,
      kThrust: resolved.k_thrust ?? rocket.simulationSettings?.kThrust ?? 1.0,
      kDrag: resolved.k_drag ?? rocket.simulationSettings?.kDrag ?? 1.0,
    },
  };
};

export const runSimulation = async (
  rocket: RocketConfig,
  env: Environment,
  launchAngleDeg: number = 90,
  railLength: number = 1.0,
  config: PhysicsConfig = DEFAULT_PHYSICS_CONFIG
): Promise<SimulationResult> => {
  const configuredRocket = applyPhysicsConfig(rocket, config);
  return runStableSimulation(configuredRocket, env, launchAngleDeg, railLength);
};

export const calibrateFromFlightData = async (
  rocket: RocketConfig,
  env: Environment,
  flightData: FlightDataPoint[],
  launchAngleDeg: number = 90,
  railLength: number = 1.0,
  initialKThrust: number = 1.0,
  initialKDrag: number = 1.0,
  maxIterations: number = 40
): Promise<CalibrationResult> => {
  const normalizedFlightData = normalizeFlightData(flightData);
  let kThrust = initialKThrust;
  let kDrag = initialKDrag;

  const evaluate = async (candidateThrust: number, candidateDrag: number) => {
    const result = await runSimulation(rocket, env, launchAngleDeg, railLength, {
      k_thrust: candidateThrust,
      k_drag: candidateDrag,
    });
    return {
      result,
      rmse: calculateTrajectoryRmse(result, normalizedFlightData),
    };
  };

  const initial = await evaluate(kThrust, kDrag);
  let bestRmse = initial.rmse;

  for (let i = 0; i < maxIterations; i++) {
    const delta = i < 10 ? 0.02 : 0.01;
    const candidates = [
      { kThrust, kDrag },
      { kThrust: Math.max(0.8, Math.min(1.2, kThrust + delta)), kDrag },
      { kThrust: Math.max(0.8, Math.min(1.2, kThrust - delta)), kDrag },
      { kThrust, kDrag: Math.max(0.7, Math.min(2.0, kDrag + delta)) },
      { kThrust, kDrag: Math.max(0.7, Math.min(2.0, kDrag - delta)) },
      { kThrust: Math.max(0.8, Math.min(1.2, kThrust + delta)), kDrag: Math.max(0.7, Math.min(2.0, kDrag + delta)) },
      { kThrust: Math.max(0.8, Math.min(1.2, kThrust - delta)), kDrag: Math.max(0.7, Math.min(2.0, kDrag - delta)) },
    ];

    let improved = false;
    for (const candidate of candidates) {
      const evaluation = await evaluate(candidate.kThrust, candidate.kDrag);
      if (evaluation.rmse + 0.001 < bestRmse) {
        bestRmse = evaluation.rmse;
        kThrust = candidate.kThrust;
        kDrag = candidate.kDrag;
        improved = true;
      }
    }

    if (!improved) {
      return {
        kThrust,
        kDrag,
        initialRMSE: initial.rmse,
        finalRMSE: bestRmse,
        improvement: initial.rmse > 0 ? ((initial.rmse - bestRmse) / initial.rmse) * 100 : 0,
        iterations: i + 1,
        convergence: true,
      };
    }
  }

  return {
    kThrust,
    kDrag,
    initialRMSE: initial.rmse,
    finalRMSE: bestRmse,
    improvement: initial.rmse > 0 ? ((initial.rmse - bestRmse) / initial.rmse) * 100 : 0,
    iterations: maxIterations,
    convergence: false,
  };
};

export const runMonteCarloSimulation = async (
  rocket: RocketConfig,
  env: Environment,
  launchAngleDeg: number = 90,
  railLength: number = 1.0,
  config: PhysicsConfig = DEFAULT_PHYSICS_CONFIG,
  monteCarloConfig: MonteCarloConfig = {}
): Promise<MonteCarloResult> => {
  const nominal = await runSimulation(rocket, env, launchAngleDeg, railLength, config);
  const runs: SimulationResult[] = [];
  const totalRuns = monteCarloConfig.runs ?? 20;

  for (let i = 0; i < totalRuns; i++) {
    const thrustJitter = 1 + (Math.random() - 0.5) * 2 * (monteCarloConfig.kThrustStdDev ?? 0.02);
    const dragJitter = 1 + (Math.random() - 0.5) * 2 * (monteCarloConfig.kDragStdDev ?? 0.05);
    const angleJitter = (Math.random() - 0.5) * 2 * (monteCarloConfig.launchAngleStdDev ?? 0.5);
    const railJitter = (Math.random() - 0.5) * 2 * (monteCarloConfig.railLengthStdDev ?? 0.02);

    runs.push(
      await runSimulation(rocket, env, launchAngleDeg + angleJitter, Math.max(0.1, railLength + railJitter), {
        ...config,
        k_thrust: (config.k_thrust ?? 1.0) * thrustJitter,
        k_drag: (config.k_drag ?? 1.0) * dragJitter,
      })
    );
  }

  return { nominal, runs };
};

export const derivatives6DOF = (): never => {
  throw new Error('derivatives6DOF has been retired. Use runSimulation() through the stable physics engine instead.');
};

