/**
 * Simulation Result Validation Tool
 * Automatically compares simulation results with measured data and generates validation reports
 */

import { SimulationResult } from '../types';
import { FlightDataPoint } from './calibrationDatabase';

export interface ValidationReport {
  apogeeError: number;          // Altitude error (%)
  velocityError: number | null; // Velocity error (%, if data available)
  flightTimeError: number | null; // Flight time error (%, if data available)
  isWithinTarget: boolean;      // Whether within target error range (≤2%)
  recommendations: string[];     // Improvement recommendations
  score: number;                 // Overall score (0-100)
}

/**
 * Generate improvement recommendations
 */
const generateRecommendations = (
  apogeeError: number,
  velocityError: number | null,
  flightTimeError: number | null
): string[] => {
  const recommendations: string[] = [];
  
  // Altitude error analysis
  if (Math.abs(apogeeError) > 5) {
    if (apogeeError > 0) {
      recommendations.push('Simulated altitude too high: Increase drag coefficient or check if thrust curve is too high');
    } else {
      recommendations.push('Simulated altitude too low: Decrease drag coefficient or check if thrust curve is too low');
    }
  } else if (Math.abs(apogeeError) > 2) {
    recommendations.push('Altitude error slightly large: Add more calibration data points to improve accuracy');
  }
  
  // Velocity error analysis
  if (velocityError !== null && Math.abs(velocityError) > 5) {
    if (velocityError > 0) {
      recommendations.push('Simulated velocity too high: Check drag model or thrust curve');
    } else {
      recommendations.push('Simulated velocity too low: Check drag model or thrust curve');
    }
  }
  
  // Flight time error analysis
  if (flightTimeError !== null && Math.abs(flightTimeError) > 5) {
    recommendations.push('Flight time error large: Check parachute deployment logic or drag model');
  }
  
  // If error is small, give positive feedback
  if (Math.abs(apogeeError) <= 2 && (velocityError === null || Math.abs(velocityError) <= 2)) {
    recommendations.push('✅ Simulation accuracy excellent! Error within target range');
  }
  
  return recommendations;
};

/**
 * Calculate overall score
 */
const calculateScore = (
  apogeeError: number,
  velocityError: number | null,
  flightTimeError: number | null
): number => {
  let score = 100;
  
  // Altitude error score (weight 60%)
  const apogeeScore = Math.max(0, 100 - Math.abs(apogeeError) * 10);
  score = score * 0.6 + apogeeScore * 0.4;
  
  // Velocity error score (weight 30%)
  if (velocityError !== null) {
    const velocityScore = Math.max(0, 100 - Math.abs(velocityError) * 10);
    score = score * 0.7 + velocityScore * 0.3;
  }
  
  // Flight time error score (weight 10%)
  if (flightTimeError !== null) {
    const timeScore = Math.max(0, 100 - Math.abs(flightTimeError) * 10);
    score = score * 0.9 + timeScore * 0.1;
  }
  
  return Math.round(score);
};

/**
 * Validate simulation results
 * Compare simulation results with measured data and generate validation report
 */
export const validateSimulation = (
  simulated: SimulationResult,
  measured: FlightDataPoint
): ValidationReport => {
  // 1. Calculate altitude error
  const apogeeError = ((simulated.apogee - measured.measuredApogee) / measured.measuredApogee) * 100;
  
  // 2. Calculate velocity error (if data available)
  let velocityError: number | null = null;
  if (measured.measuredMaxVelocity !== undefined && measured.measuredMaxVelocity > 0) {
    velocityError = ((simulated.maxVelocity - measured.measuredMaxVelocity) / measured.measuredMaxVelocity) * 100;
  }
  
  // 3. Calculate flight time error (if data available)
  let flightTimeError: number | null = null;
  if (measured.measuredFlightTime !== undefined && measured.measuredFlightTime > 0) {
    flightTimeError = ((simulated.flightTime - measured.measuredFlightTime) / measured.measuredFlightTime) * 100;
  }
  
  // 4. Check if within target range (≤2%)
  const isWithinTarget = Math.abs(apogeeError) <= 2.0 && 
                         (velocityError === null || Math.abs(velocityError) <= 2.0);
  
  // 5. Generate improvement recommendations
  const recommendations = generateRecommendations(apogeeError, velocityError, flightTimeError);
  
  // 6. Calculate overall score
  const score = calculateScore(apogeeError, velocityError, flightTimeError);
  
  return {
    apogeeError,
    velocityError,
    flightTimeError,
    isWithinTarget,
    recommendations,
    score
  };
};

/**
 * Format validation report as readable string
 */
export const formatValidationReport = (report: ValidationReport, dataPoint: FlightDataPoint): string => {
  let output = '\n📊 Validation Report\n';
  output += '='.repeat(50) + '\n';
  output += `Data point: ${dataPoint.id} (${dataPoint.motor})\n`;
  output += `\nAltitude comparison:\n`;
  output += `  Simulated: ${(dataPoint.measuredApogee + (dataPoint.measuredApogee * report.apogeeError / 100)).toFixed(1)}m\n`;
  output += `  Measured: ${dataPoint.measuredApogee.toFixed(1)}m\n`;
  output += `  Error: ${report.apogeeError > 0 ? '+' : ''}${report.apogeeError.toFixed(2)}%\n`;
  
  if (report.velocityError !== null) {
    output += `\nVelocity comparison:\n`;
    output += `  Error: ${report.velocityError > 0 ? '+' : ''}${report.velocityError.toFixed(2)}%\n`;
  }
  
  if (report.flightTimeError !== null) {
    output += `\nFlight time comparison:\n`;
    output += `  Error: ${report.flightTimeError > 0 ? '+' : ''}${report.flightTimeError.toFixed(2)}%\n`;
  }
  
  output += `\nOverall score: ${report.score}/100\n`;
  output += `Target achieved: ${report.isWithinTarget ? '✅ Yes' : '❌ No'} (error ≤ 2%)\n`;
  
  if (report.recommendations.length > 0) {
    output += `\nImprovement recommendations:\n`;
    report.recommendations.forEach((rec, i) => {
      output += `  ${i + 1}. ${rec}\n`;
    });
  }
  
  output += '='.repeat(50) + '\n';
  
  return output;
};

/**
 * Batch validate multiple data points
 */
export const validateMultipleDataPoints = async (
  simulatedResults: Array<{ dataPoint: FlightDataPoint; result: SimulationResult }>
): Promise<Array<{ dataPoint: FlightDataPoint; report: ValidationReport }>> => {
  const reports = simulatedResults.map(({ dataPoint, result }) => ({
    dataPoint,
    report: validateSimulation(result, dataPoint)
  }));
  
  // Calculate statistics
  const avgApogeeError = reports.reduce((sum, r) => sum + Math.abs(r.report.apogeeError), 0) / reports.length;
  const maxApogeeError = Math.max(...reports.map(r => Math.abs(r.report.apogeeError)));
  const avgScore = reports.reduce((sum, r) => sum + r.report.score, 0) / reports.length;
  const withinTargetCount = reports.filter(r => r.report.isWithinTarget).length;
  
  console.log('\n📊 Batch validation statistics');
  console.log('='.repeat(50));
  console.log(`Number of data points: ${reports.length}`);
  console.log(`Average altitude error: ${avgApogeeError.toFixed(2)}%`);
  console.log(`Max altitude error: ${maxApogeeError.toFixed(2)}%`);
  console.log(`Average score: ${avgScore.toFixed(1)}/100`);
  console.log(`Target achievement rate: ${((withinTargetCount / reports.length) * 100).toFixed(1)}% (${withinTargetCount}/${reports.length})`);
  console.log('='.repeat(50));
  
  return reports;
};





