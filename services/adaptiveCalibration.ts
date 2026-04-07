/**
 * Adaptive Calibration Algorithm
 * Automatically calculates optimal calibration parameters based on multiple flight data points
 */

import { FlightDataPoint, getAllDataPoints, findDataPointsByMotor } from './calibrationDatabase';
import { RocketConfig, Environment, SimulationResult } from '../types';
import { runSimulation } from './physics6dof';

export interface CalibrationParams {
  cdMultiplier: number;        // Cd correction factor
  thrustMultiplier: number;    // Thrust correction factor
  confidence: number;          // Confidence (0-1)
  avgError: number;            // Average error (%)
  maxError: number;            // Maximum error (%)
  dataPointsUsed: number;      // Number of data points used
}

export interface CalibrationError {
  dataPoint: FlightDataPoint;
  simulatedApogee: number;
  error: number;               // Absolute error (m)
  errorPercent: number;        // Relative error (%)
}

/**
 * Find optimal Cd correction factor using least squares fitting
 */
const findOptimalCdMultiplier = (
  errors: CalibrationError[],
  initialCdMultiplier: number = 1.0
): number => {
  // Simple approach: find coefficient that minimizes average error
  // More precise methods could use gradient descent or Newton's method
  
  let bestMultiplier = initialCdMultiplier;
  let minAvgError = Infinity;
  
  // Search in range 0.8 to 1.5
  for (let multiplier = 0.8; multiplier <= 1.5; multiplier += 0.01) {
    // Calculate adjusted errors
    const adjustedErrors = errors.map(e => {
      // Assume error is proportional to Cd
      const adjustedError = Math.abs(e.simulatedApogee - e.dataPoint.measuredApogee * (1 / multiplier));
      return adjustedError / e.dataPoint.measuredApogee * 100;
    });
    
    const avgError = adjustedErrors.reduce((sum, e) => sum + e, 0) / adjustedErrors.length;
    
    if (avgError < minAvgError) {
      minAvgError = avgError;
      bestMultiplier = multiplier;
    }
  }
  
  return bestMultiplier;
};

/**
 * Find optimal thrust correction factor using least squares fitting
 */
const findOptimalThrustMultiplier = (
  errors: CalibrationError[],
  initialThrustMultiplier: number = 1.0
): number => {
  let bestMultiplier = initialThrustMultiplier;
  let minAvgError = Infinity;
  
  // Search in range 0.9 to 1.1
  for (let multiplier = 0.9; multiplier <= 1.1; multiplier += 0.01) {
    const adjustedErrors = errors.map(e => {
      // Assume error is proportional to thrust
      const adjustedError = Math.abs(e.simulatedApogee - e.dataPoint.measuredApogee * multiplier);
      return adjustedError / e.dataPoint.measuredApogee * 100;
    });
    
    const avgError = adjustedErrors.reduce((sum, e) => sum + e, 0) / adjustedErrors.length;
    
    if (avgError < minAvgError) {
      minAvgError = avgError;
      bestMultiplier = multiplier;
    }
  }
  
  return bestMultiplier;
};

/**
 * Calculate calibration confidence
 */
const calculateConfidence = (errors: CalibrationError[]): number => {
  if (errors.length === 0) return 0;
  
  // Calculate confidence based on error distribution
  const avgError = errors.reduce((sum, e) => sum + Math.abs(e.errorPercent), 0) / errors.length;
  const maxError = Math.max(...errors.map(e => Math.abs(e.errorPercent)));
  
  // Lower error = higher confidence
  // Target: average error < 2%, max error < 5%
  let confidence = 1.0;
  
  if (avgError > 5) confidence *= 0.5;
  else if (avgError > 2) confidence *= 0.7;
  
  if (maxError > 10) confidence *= 0.5;
  else if (maxError > 5) confidence *= 0.8;
  
  // More data points = higher confidence
  if (errors.length >= 5) confidence *= 1.0;
  else if (errors.length >= 3) confidence *= 0.9;
  else confidence *= 0.7;
  
  return Math.min(1.0, Math.max(0.0, confidence));
};

/**
 * Auto-calibrate based on multiple data points
 */
export const calibrateFromDatabase = async (
  rocketConfig: RocketConfig,
  motorName?: string
): Promise<CalibrationParams> => {
  console.log('\n🔧 [Adaptive Calibration] Starting calibration...');
  
  // 1. Get related data points
  let dataPoints: FlightDataPoint[];
  if (motorName) {
    dataPoints = findDataPointsByMotor(motorName);
    console.log(`📊 Found ${dataPoints.length} ${motorName} related data points`);
  } else {
    dataPoints = getAllDataPoints();
    console.log(`📊 Using all ${dataPoints.length} data points`);
  }
  
  if (dataPoints.length === 0) {
    console.warn('⚠️ No calibration data points available, using default parameters');
    return {
      cdMultiplier: 1.124,  // Default (based on F42T data)
      thrustMultiplier: 0.98,
      confidence: 0.0,
      avgError: 0,
      maxError: 0,
      dataPointsUsed: 0
    };
  }
  
  // 2. Run simulation for each data point
  console.log('🔄 Running simulation for each data point...');
  const errors: CalibrationError[] = [];
  
  for (const dataPoint of dataPoints) {
    try {
      // Create environment config
      const tempC = dataPoint.temperature || 15;
      const pressureHPa = dataPoint.pressure || 1013.25;
      const env: Environment = {
        temperature: tempC,
        pressure: pressureHPa,
        humidity: dataPoint.humidity || 50,
        windSpeed: dataPoint.windSpeed,
        windDirection: dataPoint.windDirection,
        airDensity: (pressureHPa * 100) / (287.058 * (tempC + 273.15))
      };
      
      // Create temporary rocket config (using data point mass)
      const tempConfig: RocketConfig = {
        ...rocketConfig,
        stages: rocketConfig.stages, // Keep original structure
        // Note: Assumes dryMass is already correctly set
      };
      
      // Run simulation
      const simulated = await runSimulation(
        tempConfig,
        env,
        dataPoint.launchAngle || 90,
        dataPoint.railLength || 1.0
      );
      
      const error = Math.abs(simulated.apogee - dataPoint.measuredApogee);
      const errorPercent = (error / dataPoint.measuredApogee) * 100;
      
      errors.push({
        dataPoint,
        simulatedApogee: simulated.apogee,
        error,
        errorPercent
      });
      
      console.log(`  ${dataPoint.id}: Simulated=${simulated.apogee.toFixed(1)}m, Measured=${dataPoint.measuredApogee.toFixed(1)}m, Error=${errorPercent.toFixed(2)}%`);
    } catch (error) {
      console.error(`❌ Data point ${dataPoint.id} simulation failed:`, error);
    }
  }
  
  if (errors.length === 0) {
    throw new Error('All data point simulations failed');
  }
  
  // 3. Calculate optimal parameters
  console.log('📈 Calculating optimal calibration parameters...');
  const avgError = errors.reduce((sum, e) => sum + Math.abs(e.errorPercent), 0) / errors.length;
  const maxError = Math.max(...errors.map(e => Math.abs(e.errorPercent)));
  
  // Use least squares fitting
  const optimalCdMultiplier = findOptimalCdMultiplier(errors);
  const optimalThrustMultiplier = findOptimalThrustMultiplier(errors);
  const confidence = calculateConfidence(errors);
  
  const result: CalibrationParams = {
    cdMultiplier: optimalCdMultiplier,
    thrustMultiplier: optimalThrustMultiplier,
    confidence,
    avgError,
    maxError,
    dataPointsUsed: errors.length
  };
  
  console.log('\n✅ [Adaptive Calibration] Complete!');
  console.log(`   Cd correction factor: ${result.cdMultiplier.toFixed(3)}`);
  console.log(`   Thrust correction factor: ${result.thrustMultiplier.toFixed(3)}`);
  console.log(`   Average error: ${result.avgError.toFixed(2)}%`);
  console.log(`   Max error: ${result.maxError.toFixed(2)}%`);
  console.log(`   Confidence: ${(result.confidence * 100).toFixed(1)}%`);
  
  return result;
};

/**
 * Simplified optimal Cd correction factor search (based on error trend)
 */
const findOptimalCdMultiplier = (errors: CalibrationError[]): number => {
  // Analyze error pattern
  // If simulated altitude generally too high, need to increase Cd (increase drag)
  // If simulated altitude generally too low, need to decrease Cd (decrease drag)
  
  const avgErrorPercent = errors.reduce((sum, e) => sum + e.errorPercent, 0) / errors.length;
  
  // If average error positive (simulated > measured), need to increase drag
  // If average error negative (simulated < measured), need to decrease drag
  const baseMultiplier = 1.124; // Default
  const adjustment = avgErrorPercent / 100; // Convert error percent to adjustment factor
  
  // Limit adjustment range
  const multiplier = baseMultiplier * (1 + adjustment * 0.5);
  return Math.max(0.8, Math.min(1.5, multiplier));
};

/**
 * Simplified optimal thrust correction factor search
 */
const findOptimalThrustMultiplier = (errors: CalibrationError[]): number => {
  const avgErrorPercent = errors.reduce((sum, e) => sum + e.errorPercent, 0) / errors.length;
  
  // Thrust correction is opposite to altitude error
  // If simulated altitude too high, may need to reduce thrust
  const baseMultiplier = 0.98; // Default
  const adjustment = -avgErrorPercent / 200; // Smaller adjustment magnitude
  
  const multiplier = baseMultiplier * (1 + adjustment);
  return Math.max(0.9, Math.min(1.1, multiplier));
};





