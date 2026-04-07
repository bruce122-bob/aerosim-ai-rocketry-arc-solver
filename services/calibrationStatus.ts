/**
 * Calibration status management system
 * 
 * For tracking calibration status, error estimation, and generating accuracy reports
 */

export interface CalibrationHistory {
  timestamp: number;
  actualApogee: number;        // Actual flight altitude [m]
  simulatedApogee: number;     // Simulated altitude [m]
  error: number;               // Error [m]
  errorPercent: number;        // Error percentage
  kThrust?: number;            // Calibrated thrust coefficient
  kDrag?: number;              // Calibrated drag coefficient
  environment?: {
    windSpeed: number;
    temperature: number;
    humidity: number;
  };
}

export interface CalibrationStatus {
  isCalibrated: boolean;
  lastCalibrationTime?: number;
  calibrationCount: number;
  meanError: number;           // Mean error [m]
  meanErrorPercent: number;    // Mean error percentage
  stdDevError: number;         // Error standard deviation [m]
  maxError: number;            // Max error [m]
  minError: number;            // Min error [m]
  estimatedAccuracy: string;   // 'High' | 'Medium' | 'Low'
  history: CalibrationHistory[];
}

const CALIBRATION_HISTORY_KEY = 'rocket_calibration_history';
const MAX_HISTORY_SIZE = 50;  // Max 50 calibration records to save

/**
 * Load calibration history from localStorage
 */
export const loadCalibrationHistory = (): CalibrationHistory[] => {
  try {
    const stored = localStorage.getItem(CALIBRATION_HISTORY_KEY);
    if (!stored) return [];
    const history = JSON.parse(stored) as CalibrationHistory[];
    // Sort by timestamp (newest first)
    return history.sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_HISTORY_SIZE);
  } catch (error) {
    console.error('[CalibrationStatus] Failed to load calibration history:', error);
    return [];
  }
};

/**
 * Save calibration history to localStorage
 */
export const saveCalibrationHistory = (history: CalibrationHistory[]): void => {
  try {
    // Limit history size
    const limitedHistory = history.slice(0, MAX_HISTORY_SIZE);
    localStorage.setItem(CALIBRATION_HISTORY_KEY, JSON.stringify(limitedHistory));
  } catch (error) {
    console.error('[CalibrationStatus] Failed to save calibration history:', error);
  }
};

/**
 * Add new calibration record
 */
export const addCalibrationRecord = (
  actualApogee: number,
  simulatedApogee: number,
  kThrust?: number,
  kDrag?: number,
  environment?: { windSpeed: number; temperature: number; humidity: number }
): CalibrationHistory => {
  const error = Math.abs(simulatedApogee - actualApogee);
  const errorPercent = (error / actualApogee) * 100;
  
  const record: CalibrationHistory = {
    timestamp: Date.now(),
    actualApogee,
    simulatedApogee,
    error,
    errorPercent,
    kThrust,
    kDrag,
    environment
  };
  
  const history = loadCalibrationHistory();
  history.unshift(record);  // Add to beginning
  saveCalibrationHistory(history);
  
  console.log(`[CalibrationStatus] New calibration record: actual=${actualApogee.toFixed(1)}m, simulated=${simulatedApogee.toFixed(1)}m, error=${errorPercent.toFixed(2)}%`);
  
  return record;
};

/**
 * Calculate calibration status statistics
 */
export const calculateCalibrationStatus = (history: CalibrationHistory[]): CalibrationStatus => {
  if (history.length === 0) {
    return {
      isCalibrated: false,
      calibrationCount: 0,
      meanError: 0,
      meanErrorPercent: 0,
      stdDevError: 0,
      maxError: 0,
      minError: 0,
      estimatedAccuracy: 'Unknown',
      history: []
    };
  }
  
  const errors = history.map(h => h.error);
  const errorPercents = history.map(h => h.errorPercent);
  
  const meanError = errors.reduce((a, b) => a + b, 0) / errors.length;
  const meanErrorPercent = errorPercents.reduce((a, b) => a + b, 0) / errorPercents.length;
  
  const variance = errors.reduce((sum, err) => sum + Math.pow(err - meanError, 2), 0) / errors.length;
  const stdDevError = Math.sqrt(variance);
  
  const maxError = Math.max(...errors);
  const minError = Math.min(...errors);
  
  // Evaluate accuracy level
  let estimatedAccuracy: 'High' | 'Medium' | 'Low';
  if (meanErrorPercent < 3) {
    estimatedAccuracy = 'High';
  } else if (meanErrorPercent < 8) {
    estimatedAccuracy = 'Medium';
  } else {
    estimatedAccuracy = 'Low';
  }
  
  return {
    isCalibrated: true,
    lastCalibrationTime: history[0]?.timestamp,
    calibrationCount: history.length,
    meanError,
    meanErrorPercent,
    stdDevError,
    maxError,
    minError,
    estimatedAccuracy,
    history
  };
};

/**
 * Get current calibration status
 */
export const getCalibrationStatus = (): CalibrationStatus => {
  const history = loadCalibrationHistory();
  return calculateCalibrationStatus(history);
};

/**
 * Clear calibration history
 */
export const clearCalibrationHistory = (): void => {
  localStorage.removeItem(CALIBRATION_HISTORY_KEY);
  console.log('[CalibrationStatus] Calibration history cleared');
};

/**
 * Generate accuracy report (text format)
 */
export const generateAccuracyReport = (status: CalibrationStatus): string => {
  if (!status.isCalibrated) {
    return 'No calibration performed yet. Please use actual flight data to calibrate simulation parameters.';
  }
  
  const report = [
    '=== Simulation Accuracy Report ===',
    '',
    `Calibration status: ${status.isCalibrated ? 'Calibrated' : 'Not calibrated'}`,
    `Calibration count: ${status.calibrationCount}`,
    `Last calibration: ${status.lastCalibrationTime ? new Date(status.lastCalibrationTime).toLocaleString() : 'Unknown'}`,
    '',
    'Error statistics:',
    `  Mean error: ${status.meanError.toFixed(2)} m (${status.meanErrorPercent.toFixed(2)}%)`,
    `  Standard deviation: ${status.stdDevError.toFixed(2)} m`,
    `  Max error: ${status.maxError.toFixed(2)} m`,
    `  Min error: ${status.minError.toFixed(2)} m`,
    '',
    `Accuracy assessment: ${status.estimatedAccuracy}`,
    '',
    status.estimatedAccuracy === 'High' && status.meanErrorPercent < 5
      ? '✅ Simulation accuracy meets <5% target'
      : status.estimatedAccuracy === 'Medium'
      ? '⚠️  Simulation accuracy near target (more calibration data recommended)'
      : '❌ Simulation accuracy needs improvement (check parameters and calibration data)'
  ].filter(Boolean);
  
  return report.join('\n');
};
