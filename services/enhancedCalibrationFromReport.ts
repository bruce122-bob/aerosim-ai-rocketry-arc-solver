/**
 * Enhanced Calibration System Based on PDF Report Data
 * Uses actual flight data from 6 rockets to improve simulation accuracy
 */

import { RocketConfig, Environment } from '../types';

/**
 * Actual flight data for 6 rockets from PDF report
 * Used to calibrate simulator parameters
 */
export interface ReportRocketData {
    name: string;
    avgApogee_ft: number;
    avgMass_g: number;
    launchCount: number;
    stdDev_ft: number;
    motor?: string;
    motorSerial?: string;
}

// 2025 competition rules: Maximum mass limit 650g
// Historical data >650g has been filtered out
export const REPORT_ROCKET_DATA: ReportRocketData[] = [
    {
        name: 'P52 Rocket',
        avgApogee_ft: 808.2,
        avgMass_g: 601.9,
        launchCount: 10,
        stdDev_ft: 54.3
    },
    {
        name: 'Project Epsilon',
        avgApogee_ft: 853.0,
        avgMass_g: 579.5,
        launchCount: 4,
        stdDev_ft: 58.7
    },
    {
        name: 'New Design',
        avgApogee_ft: 796.7,
        avgMass_g: 569.5,
        launchCount: 13,
        stdDev_ft: 30.8
    },
    {
        name: 'Vincent Rocket',
        avgApogee_ft: 809.0,
        avgMass_g: 591.6,
        launchCount: 1,
        stdDev_ft: 0,
        motor: 'F42-6T',
        motorSerial: '124'
    },
    {
        name: 'White (YK 4.0)',
        avgApogee_ft: 746.5,
        avgMass_g: 594.4,
        launchCount: 2,
        stdDev_ft: 41.7,
        motor: 'F42-6T',
        motorSerial: '124'
    }
    // Note: Cheese Rocket (669.6g) removed - exceeds 2025 competition rule limit (650g)
];

/**
 * Calculate mass-performance relationship from report data
 * Finding: Lightweight design helps improve performance (negative correlation)
 */
export const calculateMassPerformanceModel = (): {
    slope: number;      // ft per gram
    intercept: number;  // ft
    rSquared: number;
} => {
    // Use linear regression on all rocket data meeting 2025 competition rules (≤650g)
    // Historical data >650g has been filtered out
    const masses = REPORT_ROCKET_DATA.map(r => r.avgMass_g);
    const apogees = REPORT_ROCKET_DATA.map(r => r.avgApogee_ft);
    
    const n = masses.length;
    const sumX = masses.reduce((a, b) => a + b, 0);
    const sumY = apogees.reduce((a, b) => a + b, 0);
    const sumXY = masses.reduce((sum, m, i) => sum + m * apogees[i], 0);
    const sumX2 = masses.reduce((sum, m) => sum + m * m, 0);
    const sumY2 = apogees.reduce((sum, a) => sum + a * a, 0);
    
    const meanX = sumX / n;
    const meanY = sumY / n;
    
    // Linear regression: y = slope * x + intercept
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = meanY - slope * meanX;
    
    // Calculate R²
    const ssRes = masses.reduce((sum, m, i) => {
        const predicted = slope * m + intercept;
        return sum + Math.pow(apogees[i] - predicted, 2);
    }, 0);
    const ssTot = apogees.reduce((sum, a) => sum + Math.pow(a - meanY, 2), 0);
    const rSquared = 1 - (ssRes / ssTot);
    
    console.log(`[REPORT CALIBRATION] Mass-performance model: Apogee = ${slope.toFixed(3)} × Mass + ${intercept.toFixed(1)} (R²=${rSquared.toFixed(3)})`);
    
    return { slope, intercept, rSquared };
};

/**
 * Calculate average Cd correction factor from report data
 * Calibrate by comparing theoretical and actual altitude
 * Optimized version: Dynamic adjustment by mass, using refined mass segments
 */
export const calculateAverageCdCorrection = (mass_g?: number): number => {
    // M20: Base Cd correction factor (reduced from 1.65 to physically reasonable 1.15)
    // This correction is applied ON TOP of the physics engine's own drag model,
    // so it should represent only the real-world excess drag (surface roughness,
    // launch lugs, rail buttons, etc.), NOT compensate for systematic engine errors.
    // Previous 1.65 was masking engine bugs that have now been fixed.
    let baseCorrection = 1.15;
    
    // If mass info available, perform mass-related fine adjustment
    // 2025 competition rules: Maximum mass limit 650g
    if (mass_g !== undefined) {
        // Detailed analysis based on report data (≤650g only):
        // Project Epsilon: 579.5g → 853ft (highest, most streamlined)
        // New Design: 569.5g → 796.7ft (light but not as good as Epsilon)
        // P52: 601.9g → 808.2ft (medium-heavy)
        // Vincent: 591.6g → 809.0ft (medium)
        // White YK 4.0: 594.4g → 746.5ft (medium, but had issues)
        
        if (mass_g < 580) {
            // Ultra-lightweight (Project Epsilon type: 579.5g reaches 853ft)
            // These designs very streamlined, Cd correction should be minimal
            baseCorrection *= 0.95; // Reduce 5%
        } else if (mass_g < 595) {
            // Lightweight (New Design type: 569.5g, White YK 4.0: 594.4g)
            // Streamlined design, but not as good as Epsilon
            baseCorrection *= 0.97; // Reduce 3%
        } else if (mass_g < 605) {
            // Medium (Vincent: 591.6g, P52: 601.9g)
            baseCorrection *= 0.99; // Reduce 1%
        } else if (mass_g <= 650) {
            // Standard to limit (605-650g, meets 2025 competition rules)
            // Use base correction, no adjustment
            baseCorrection *= 1.00;
        } else {
            // Exceeds competition limit (>650g) - should not occur, but provide warning
            console.warn(`[REPORT CALIBRATION] ⚠️ Warning: Mass ${mass_g}g exceeds 2025 competition limit (650g)`);
            baseCorrection *= 1.00; // Use standard correction
        }
    }
    
    return baseCorrection;
};

/**
 * Calculate thrust correction factor from report data
 * Accounts for motor performance variation
 */
export const calculateThrustCorrection = (motorName?: string): number => {
    // Based on report and previous calibration data
    // Most motors have actual thrust slightly below nominal (2-5%)
    
    if (motorName && motorName.includes('F42')) {
        // F42 series: Based on actual data, thrust ~98% of nominal
        return 0.98;
    }
    
    // Default: Conservative estimate, 98% nominal thrust
    return 0.98;
};

/**
 * Optimize real-world effect parameters from report data
 * Returns optimized calibration parameters
 */
export interface OptimizedCalibrationParams {
    cdMultiplier: number;      // Cd correction factor
    thrustMultiplier: number;   // Thrust correction factor
    massPerformanceSlope: number; // Mass-performance slope
    massPerformanceIntercept: number; // Mass-performance intercept
    recommendedCd: number;      // Recommended Cd based on mass
}

export const optimizeCalibrationFromReport = (
    rocket: RocketConfig,
    env: Environment
): OptimizedCalibrationParams => {
    const totalMass_g = (rocket.manualOverride?.mass || 0.6) * 1000;
    const motorName = rocket.motor?.name || '';
    
    // Check if mass meets 2025 competition rules (≤650g)
    if (totalMass_g > 650) {
        console.warn(`[REPORT CALIBRATION] ⚠️ Warning: Mass ${totalMass_g.toFixed(1)}g exceeds 2025 competition limit (650g)`);
    }
    
    // 1. Calculate mass-performance model (based on ≤650g data)
    const massModel = calculateMassPerformanceModel();
    
    // 2. Predict expected altitude based on mass
    const predictedApogee = massModel.slope * totalMass_g + massModel.intercept;
    
    // 3. Calculate Cd correction factor (mass-optimized, meets 2025 rules)
    const cdCorrection = calculateAverageCdCorrection(totalMass_g);
    
    // 4. Calculate thrust correction
    const thrustCorrection = calculateThrustCorrection(motorName);
    
    // 5. Recommend Cd value based on mass
    // Use optimized Cd correction factor
    let recommendedCd = rocket.cdOverride || 0.55;
    recommendedCd *= cdCorrection;
    
    console.log(`[REPORT CALIBRATION] ====== Calibration based on report data (2025 rules) ======`);
    console.log(`[REPORT CALIBRATION] Rocket mass: ${totalMass_g.toFixed(1)}g ${totalMass_g > 650 ? '⚠️ Exceeds limit' : '✅ Meets rules'}`);
    console.log(`[REPORT CALIBRATION] Predicted altitude (mass model): ${predictedApogee.toFixed(1)}ft`);
    console.log(`[REPORT CALIBRATION] Cd correction factor: ${cdCorrection.toFixed(3)}`);
    console.log(`[REPORT CALIBRATION] Thrust correction factor: ${thrustCorrection.toFixed(3)}`);
    console.log(`[REPORT CALIBRATION] Recommended Cd: ${recommendedCd.toFixed(3)}`);
    console.log(`[REPORT CALIBRATION] ====================================`);
    
    return {
        cdMultiplier: cdCorrection,
        thrustMultiplier: thrustCorrection,
        massPerformanceSlope: massModel.slope,
        massPerformanceIntercept: massModel.intercept,
        recommendedCd
    };
};

/**
 * Validate simulation accuracy from report data
 * Compare simulation results with actual data
 */
export const validateSimulationAccuracy = (
    simulatedApogee_ft: number,
    actualApogee_ft: number,
    mass_g: number,
    motorName?: string
): {
    error: number;
    errorPercent: number;
    isAccurate: boolean;
    recommendations: string[];
} => {
    const error = Math.abs(simulatedApogee_ft - actualApogee_ft);
    const errorPercent = (error / actualApogee_ft) * 100;
    const isAccurate = errorPercent <= 5.0; // Target: error ≤ 5%
    
    const recommendations: string[] = [];
    
    if (errorPercent > 5.0) {
        if (simulatedApogee_ft > actualApogee_ft) {
            recommendations.push(`Simulated altitude too high, consider increasing Cd correction factor (current error: +${errorPercent.toFixed(1)}%)`);
        } else {
            recommendations.push(`Simulated altitude too low, consider decreasing Cd correction factor or check thrust settings (current error: -${errorPercent.toFixed(1)}%)`);
        }
    }
    
    // Mass-based check
    const massModel = calculateMassPerformanceModel();
    const expectedApogee = massModel.slope * mass_g + massModel.intercept;
    const massModelError = Math.abs(actualApogee_ft - expectedApogee);
    
    if (massModelError > 50) {
        recommendations.push(`Mass-performance model prediction error large (${massModelError.toFixed(1)}ft), may need to consider other factors (e.g. design differences)`);
    }
    
    // F42-6T special check
    if (motorName && motorName.includes('F42-6T')) {
        const f42Data = REPORT_ROCKET_DATA.filter(r => r.motor === 'F42-6T');
        const avgF42Apogee = f42Data.reduce((sum, r) => sum + r.avgApogee_ft, 0) / f42Data.length;
        
        if (Math.abs(actualApogee_ft - avgF42Apogee) > 100) {
            recommendations.push(`F42-6T motor typical altitude ~${avgF42Apogee.toFixed(0)}ft, current result differs significantly`);
        }
    }
    
    console.log(`[REPORT VALIDATION] Simulated altitude: ${simulatedApogee_ft.toFixed(1)}ft`);
    console.log(`[REPORT VALIDATION] Actual altitude: ${actualApogee_ft.toFixed(1)}ft`);
    console.log(`[REPORT VALIDATION] Error: ${error.toFixed(1)}ft (${errorPercent.toFixed(1)}%)`);
    console.log(`[REPORT VALIDATION] Accuracy: ${isAccurate ? '✅ Excellent' : '⚠️ Needs improvement'}`);
    
    return {
        error,
        errorPercent,
        isAccurate,
        recommendations
    };
};

