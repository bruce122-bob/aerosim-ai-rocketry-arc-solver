// Monte Carlo Uncertainty Analysis System
// NASA-grade statistical analysis tools

import { RocketConfig, Environment, SimulationResult } from "../types";
import { runSimulation } from "./physics6dofStable";
import { perturbWindProfile } from "./windField";

// ============= Uncertainty Parameter Definitions =============
interface UncertaintyParams {
  // Aerodynamic parameter uncertainty
  cd_uncertainty: number;           // Cd coefficient ±%
  cp_uncertainty: number;           // CP position ±m
  
  // Environment uncertainty
  wind_speed_uncertainty: number;    // Wind speed ±m/s
  wind_direction_uncertainty: number; // Wind direction ±degrees
  temperature_uncertainty: number;   // Temperature ±°C
  pressure_uncertainty: number;      // Pressure ±hPa
  
  // Propulsion system uncertainty
  thrust_uncertainty: number;        // Thrust ±%
  burn_time_uncertainty: number;     // Burn time ±%
  
  // Mass uncertainty
  mass_uncertainty: number;          // Mass ±%
  
  // Launch parameter uncertainty
  launch_angle_uncertainty: number;  // Launch angle ±degrees
  rod_length_uncertainty: number;    // Rail length ±m
}

// Default uncertainty parameters (based on NASA standards)
export const DEFAULT_UNCERTAINTY: UncertaintyParams = {
  cd_uncertainty: 0.10,              // ±10%
  cp_uncertainty: 0.005,             // ±5mm
  wind_speed_uncertainty: 2.0,       // ±2 m/s
  wind_direction_uncertainty: 15,    // ±15°
  temperature_uncertainty: 5.0,      // ±5°C
  pressure_uncertainty: 10,          // ±10 hPa
  thrust_uncertainty: 0.05,          // ±5%
  burn_time_uncertainty: 0.03,       // ±3%
  mass_uncertainty: 0.02,            // ±2%
  launch_angle_uncertainty: 2.0,     // ±2°
  rod_length_uncertainty: 0.05       // ±5cm
};

// ============= Monte Carlo Results =============
export interface MonteCarloResult {
  nominal: SimulationResult;
  runs: SimulationResult[];
  statistics: {
    apogee: { mean: number, std: number, min: number, max: number, percentiles: { p5: number, p50: number, p95: number } };
    maxVelocity: { mean: number, std: number, min: number, max: number, percentiles: { p5: number, p50: number, p95: number } };
    flightTime: { mean: number, std: number, min: number, max: number, percentiles: { p5: number, p50: number, p95: number } };
    landingRange: { mean: number, std: number, min: number, max: number, percentiles: { p5: number, p50: number, p95: number } };
  };
  confidence: {
    apogee_95_ci: [number, number];
    maxVelocity_95_ci: [number, number];
    flightTime_95_ci: [number, number];
    landingRange_95_ci: [number, number];
  };
}

// ============= Random Number Generator (Normal Distribution) =============
const boxMullerTransform = (): number => {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
};

const normalRandom = (mean: number, stdDev: number): number => {
  return mean + boxMullerTransform() * stdDev;
};

// ============= Statistical Calculation =============
const calculateStatistics = (values: number[]) => {
  if (values.length === 0) {
    return {
      mean: 0,
      std: 0,
      min: 0,
      max: 0,
      percentiles: { p5: 0, p50: 0, p95: 0 },
      ci_95: [0, 0] as [number, number]
    };
  }
  
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (n - 1);
  const std = Math.sqrt(variance);
  
  const min = sorted[0];
  const max = sorted[n - 1];
  
  const p5 = sorted[Math.floor(n * 0.05)] || sorted[0];
  const p50 = sorted[Math.floor(n * 0.50)] || sorted[Math.floor(n / 2)];
  const p95 = sorted[Math.floor(n * 0.95)] || sorted[n - 1];
  
  // 95% confidence interval (based on t-distribution, approximated as normal)
  const z_95 = 1.96;
  const ci_half_width = z_95 * std / Math.sqrt(n);
  const ci_95: [number, number] = [mean - ci_half_width, mean + ci_half_width];
  
  return {
    mean,
    std,
    min,
    max,
    percentiles: { p5, p50, p95 },
    ci_95
  };
};

// ============= Main Monte Carlo Function =============
export const runMonteCarloAnalysis = async (
  nominalRocket: RocketConfig,
  nominalEnv: Environment,
  nominalLaunchAngle: number,
  nominalRodLength: number,
  uncertainty: UncertaintyParams = DEFAULT_UNCERTAINTY,
  numRuns: number = 1000,
  onProgress?: (progress: number) => void
): Promise<MonteCarloResult> => {
  
  console.log(`🎲 Starting Monte Carlo analysis: ${numRuns} runs`);
  
  // 1. Run nominal case
  const nominal = await runSimulation(nominalRocket, nominalEnv, nominalLaunchAngle, nominalRodLength);
  
  // 2. Run Monte Carlo sampling
  const runs: SimulationResult[] = [];
  
  for (let i = 0; i < numRuns; i++) {
    // Generate perturbed parameters
    const perturbedRocket = { ...nominalRocket };
    
    // Cd perturbation
    perturbedRocket.cdOverride = nominalRocket.cdOverride * (1 + normalRandom(0, uncertainty.cd_uncertainty));
    
    // Thrust curve perturbation
    const thrustFactor = 1 + normalRandom(0, uncertainty.thrust_uncertainty);
    const burnTimeFactor = 1 + normalRandom(0, uncertainty.burn_time_uncertainty);
    
    perturbedRocket.motor = {
      ...nominalRocket.motor,
      thrustCurve: nominalRocket.motor.thrustCurve.map(point => ({
        time: point.time * burnTimeFactor,
        thrust: point.thrust * thrustFactor
      })),
      burnTime: nominalRocket.motor.burnTime * burnTimeFactor
    };
    
    // Mass perturbation
    const massFactor = 1 + normalRandom(0, uncertainty.mass_uncertainty);
    perturbedRocket.stages = perturbedRocket.stages.map(stage => ({
      ...stage,
      mass: stage.mass * massFactor
    }));
    
    // Environment perturbation
    const speedDelta = normalRandom(0, uncertainty.wind_speed_uncertainty);
    const directionDelta = normalRandom(0, uncertainty.wind_direction_uncertainty);
    const gustScale = normalRandom(0, 0.2);
    const perturbedEnvBase: Environment = {
      ...nominalEnv,
      temperature: nominalEnv.temperature + normalRandom(0, uncertainty.temperature_uncertainty),
      pressure: nominalEnv.pressure + normalRandom(0, uncertainty.pressure_uncertainty),
      windSpeed: Math.max(0, nominalEnv.windSpeed + speedDelta),
      windDirection: (nominalEnv.windDirection + directionDelta + 360) % 360,
      humidity: nominalEnv.humidity,
      airDensity: undefined // Will be calculated automatically by atmosphere model
    };
    const perturbedEnv = perturbWindProfile(perturbedEnvBase, speedDelta, directionDelta, gustScale);
    
    // Launch parameter perturbation
    const perturbedLaunchAngle = nominalLaunchAngle + normalRandom(0, uncertainty.launch_angle_uncertainty);
    const perturbedRodLength = Math.max(0.1, nominalRodLength + normalRandom(0, uncertainty.rod_length_uncertainty));
    
    // Run perturbed simulation
    try {
      const result = await runSimulation(perturbedRocket, perturbedEnv, perturbedLaunchAngle, perturbedRodLength);
      runs.push(result);
    } catch (error) {
      console.warn(`Monte Carlo run ${i + 1} failed:`, error);
      // Use nominal result as fallback
      runs.push(nominal);
    }
    
    // Progress report (every 10% or every 100 runs)
    if (onProgress) {
      const reportInterval = Math.max(1, Math.floor(numRuns / 100)); // Report at least every 1 run
      if ((i + 1) % reportInterval === 0 || i === numRuns - 1) {
        onProgress((i + 1) / numRuns);
      }
    }
  }
  
  console.log(`✅ Monte Carlo analysis complete: ${runs.length}/${numRuns} runs successful`);
  
  // 3. Statistical analysis
  const apogees = runs.map(r => r.apogee);
  const maxVelocities = runs.map(r => r.maxVelocity);
  const flightTimes = runs.map(r => r.flightTime);
  const landingRanges = runs.map(r => {
    const lastPoint = r.data[r.data.length - 1];
    return lastPoint ? lastPoint.range : 0;
  });
  
  const apogee_stats = calculateStatistics(apogees);
  const maxVelocity_stats = calculateStatistics(maxVelocities);
  const flightTime_stats = calculateStatistics(flightTimes);
  const landingRange_stats = calculateStatistics(landingRanges);
  
  return {
    nominal,
    runs,
    statistics: {
      apogee: apogee_stats,
      maxVelocity: maxVelocity_stats,
      flightTime: flightTime_stats,
      landingRange: landingRange_stats
    },
    confidence: {
      apogee_95_ci: apogee_stats.ci_95,
      maxVelocity_95_ci: maxVelocity_stats.ci_95,
      flightTime_95_ci: flightTime_stats.ci_95,
      landingRange_95_ci: landingRange_stats.ci_95
    }
  };
};

// ============= Sensitivity Analysis =============
export interface SensitivityResult {
  parameter: string;
  nominal: number;
  low: number;
  high: number;
  sensitivity: number; // (high - low) / (2 * perturbation)
}

export const runSensitivityAnalysis = async (
  rocket: RocketConfig,
  env: Environment,
  launchAngle: number,
  rodLength: number,
  perturbation: number = 0.1 // 10% perturbation
): Promise<SensitivityResult[]> => {
  
  console.log(`📈 Starting sensitivity analysis`);
  
  const nominal = await runSimulation(rocket, env, launchAngle, rodLength);
  const results: SensitivityResult[] = [];
  
  // Cd sensitivity
  const cdLow = await runSimulation({ ...rocket, cdOverride: rocket.cdOverride * (1 - perturbation) }, env, launchAngle, rodLength);
  const cdHigh = await runSimulation({ ...rocket, cdOverride: rocket.cdOverride * (1 + perturbation) }, env, launchAngle, rodLength);
  results.push({
    parameter: 'Drag Coefficient (Cd)',
    nominal: nominal.apogee,
    low: cdLow.apogee,
    high: cdHigh.apogee,
    sensitivity: (cdHigh.apogee - cdLow.apogee) / (2 * perturbation * rocket.cdOverride)
  });
  
  // Mass sensitivity
  const massRocketLow = {
    ...rocket,
    stages: rocket.stages.map(s => ({ ...s, mass: s.mass * (1 - perturbation) }))
  };
  const massRocketHigh = {
    ...rocket,
    stages: rocket.stages.map(s => ({ ...s, mass: s.mass * (1 + perturbation) }))
  };
  const massLow = await runSimulation(massRocketLow, env, launchAngle, rodLength);
  const massHigh = await runSimulation(massRocketHigh, env, launchAngle, rodLength);
  results.push({
    parameter: 'Rocket Mass',
    nominal: nominal.apogee,
    low: massLow.apogee,
    high: massHigh.apogee,
    sensitivity: (massHigh.apogee - massLow.apogee) / (2 * perturbation * rocket.stages[0].mass)
  });
  
  // Wind speed sensitivity
  const windLow = await runSimulation(rocket, perturbWindProfile({ ...env, windSpeed: Math.max(0, env.windSpeed - 2) }, -2, -10, -0.15), launchAngle, rodLength);
  const windHigh = await runSimulation(rocket, perturbWindProfile({ ...env, windSpeed: env.windSpeed + 2 }, 2, 10, 0.15), launchAngle, rodLength);
  results.push({
    parameter: 'Wind Speed',
    nominal: nominal.apogee,
    low: windLow.apogee,
    high: windHigh.apogee,
    sensitivity: (windHigh.apogee - windLow.apogee) / 4.0
  });
  
  console.log(`✅ Sensitivity analysis complete`);
  
  return results;
};

// ============= Risk Assessment =============
export interface RiskAssessment {
  probability_below_min_altitude: number; // Probability of being below minimum safe altitude
  probability_exceed_max_range: number;    // Probability of exceeding maximum safe range
  probability_high_descent_rate: number;   // Probability of high descent rate
  overall_risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  recommendations: string[];
}

export const assessRisk = (
  monteCarloResult: MonteCarloResult,
  minSafeAltitude: number = 50,
  maxSafeRange: number = 500,
  maxDescentRate: number = 10
): RiskAssessment => {
  
  const runs = monteCarloResult.runs;
  const n = runs.length;
  
  // Calculate risk probabilities
  const belowMinAltitude = runs.filter(r => r.apogee < minSafeAltitude).length;
  const exceedMaxRange = runs.filter(r => {
    const lastPoint = r.data[r.data.length - 1];
    return lastPoint && lastPoint.range > maxSafeRange;
  }).length;
  const highDescentRate = runs.filter(r => {
    // Check average descent rate over last 5 seconds
    const descendData = r.data.filter(d => d.velocityY < -1).slice(-50);
    if (descendData.length === 0) return false;
    const avgDescentRate = descendData.reduce((sum, d) => sum + Math.abs(d.velocityY), 0) / descendData.length;
    return avgDescentRate > maxDescentRate;
  }).length;
  
  const prob_low_alt = belowMinAltitude / n;
  const prob_high_range = exceedMaxRange / n;
  const prob_high_descent = highDescentRate / n;
  
  // Overall risk level
  let overallRisk: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
  if (prob_low_alt > 0.05 || prob_high_range > 0.10 || prob_high_descent > 0.15) {
    overallRisk = 'HIGH';
  } else if (prob_low_alt > 0.01 || prob_high_range > 0.05 || prob_high_descent > 0.05) {
    overallRisk = 'MEDIUM';
  }
  
  // Generate recommendations
  const recommendations: string[] = [];
  if (prob_low_alt > 0.01) {
    recommendations.push(`⚠️ ${(prob_low_alt * 100).toFixed(1)}% probability below safe altitude. Consider increasing thrust or reducing mass.`);
  }
  if (prob_high_range > 0.05) {
    recommendations.push(`⚠️ ${(prob_high_range * 100).toFixed(1)}% probability of exceeding safe range. Consider adjusting launch angle or waiting for lower wind speed.`);
  }
  if (prob_high_descent > 0.05) {
    recommendations.push(`⚠️ ${(prob_high_descent * 100).toFixed(1)}% probability of excessive descent rate. Consider using a larger parachute.`);
  }
  if (overallRisk === 'LOW') {
    recommendations.push(`✅ Launch conditions good, risk acceptable.`);
  }
  
  return {
    probability_below_min_altitude: prob_low_alt,
    probability_exceed_max_range: prob_high_range,
    probability_high_descent_rate: prob_high_descent,
    overall_risk_level: overallRisk,
    recommendations
  };
};
