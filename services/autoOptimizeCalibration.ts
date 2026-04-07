/**
 * Auto-optimize calibration parameters
 * Iteratively optimize based on report data to achieve near-perfect simulation accuracy (<2% error)
 */

import { REPORT_ROCKET_DATA, ReportRocketData } from './enhancedCalibrationFromReport';

interface CalibrationParams {
    baseCdCorrection: number;
    massAdjustments: {
        veryLight: number;    // <580g
        light: number;        // 580-600g
        medium: number;       // 600-640g
        heavy: number;        // 640-660g
        veryHeavy: number;    // >660g
    };
    thrustCorrection: number;
}

interface OptimizationResult {
    params: CalibrationParams;
    meanError: number;
    maxError: number;
    rmse: number;
    accuracy: number; // Percentage of rockets with <2% error
}

/**
 * Inverse-calculate optimal Cd correction coefficient from report data
 * Find best parameters using iterative optimization
 */
export function optimizeCalibrationParams(): CalibrationParams {
    console.log('[AUTO OPTIMIZE] Starting auto-optimization of calibration parameters...\n');
    
    // Initial parameters (based on prior analysis)
    let bestParams: CalibrationParams = {
        baseCdCorrection: 1.124,
        massAdjustments: {
            veryLight: 0.96,   // <580g: Project Epsilon type
            light: 0.98,       // 580-600g: New Design type
            medium: 1.00,      // 600-640g: Standard
            heavy: 1.01,       // 640-660g: Medium-heavy
            veryHeavy: 1.03    // >660g: Cheese Rocket type
        },
        thrustCorrection: 0.98
    };
    
    let bestError = Infinity;
    let bestResult: OptimizationResult | null = null;
    
    // Grid search optimization
    // Test different base correction coefficients
    const baseCorrections = [1.10, 1.12, 1.124, 1.13, 1.14, 1.15];
    const massAdjustments = [
        { veryLight: 0.94, light: 0.96, medium: 1.00, heavy: 1.02, veryHeavy: 1.04 },
        { veryLight: 0.95, light: 0.97, medium: 1.00, heavy: 1.02, veryHeavy: 1.03 },
        { veryLight: 0.96, light: 0.98, medium: 1.00, heavy: 1.01, veryHeavy: 1.03 },
        { veryLight: 0.97, light: 0.99, medium: 1.00, heavy: 1.01, veryHeavy: 1.02 },
    ];
    
    for (const baseCorr of baseCorrections) {
        for (const massAdj of massAdjustments) {
            const params: CalibrationParams = {
                baseCdCorrection: baseCorr,
                massAdjustments: massAdj,
                thrustCorrection: 0.98
            };
            
            const result = evaluateCalibration(params);
            
            if (result.meanError < bestError) {
                bestError = result.meanError;
                bestParams = params;
                bestResult = result;
            }
        }
    }
    
    if (bestResult) {
        console.log('[AUTO OPTIMIZE] ✅ Found optimal parameters:');
        console.log(`   Base Cd correction: ${bestParams.baseCdCorrection.toFixed(3)}`);
        console.log(`   Mass adjustment: <580g=${bestParams.massAdjustments.veryLight.toFixed(2)}, ` +
                   `580-600g=${bestParams.massAdjustments.light.toFixed(2)}, ` +
                   `600-640g=${bestParams.massAdjustments.medium.toFixed(2)}, ` +
                   `640-660g=${bestParams.massAdjustments.heavy.toFixed(2)}, ` +
                   `>660g=${bestParams.massAdjustments.veryHeavy.toFixed(2)}`);
        console.log(`   Thrust correction: ${bestParams.thrustCorrection.toFixed(3)}`);
        console.log(`\n   Optimization results:`);
        console.log(`   Mean error: ${bestResult.meanError.toFixed(2)}%`);
        console.log(`   Max error: ${bestResult.maxError.toFixed(2)}%`);
        console.log(`   RMSE: ${bestResult.rmse.toFixed(1)}ft`);
        console.log(`   Accuracy (<2%): ${(bestResult.accuracy * 100).toFixed(0)}%`);
    }
    
    return bestParams;
}

/**
 * Evaluate calibration parameter quality
 * Use simplified physics model to estimate simulation results
 */
function evaluateCalibration(params: CalibrationParams): OptimizationResult {
    // Simplified physics model: assume altitude inversely proportional to Cd, proportional to thrust
    // Apogee ∝ (Thrust / Cd)^0.5 (simplified model)
    
    const errors: number[] = [];
    const absoluteErrors: number[] = [];
    let accurateCount = 0;
    
    for (const rocket of REPORT_ROCKET_DATA) {
        // Calculate applied Cd correction
        let cdCorrection = params.baseCdCorrection;
        
        if (rocket.avgMass_g < 580) {
            cdCorrection *= params.massAdjustments.veryLight;
        } else if (rocket.avgMass_g < 600) {
            cdCorrection *= params.massAdjustments.light;
        } else if (rocket.avgMass_g < 640) {
            cdCorrection *= params.massAdjustments.medium;
        } else if (rocket.avgMass_g < 660) {
            cdCorrection *= params.massAdjustments.heavy;
        } else {
            cdCorrection *= params.massAdjustments.veryHeavy;
        }
        
        // Simplified altitude estimate (mass-performance model)
        // Use mass-performance relationship from report, but apply Cd and thrust correction
        const baseApogee = -0.5 * rocket.avgMass_g + 1100; // Simplified linear model
        const correctedApogee = baseApogee * Math.sqrt(params.thrustCorrection / cdCorrection);
        
        const error = Math.abs(correctedApogee - rocket.avgApogee_ft);
        const errorPercent = (error / rocket.avgApogee_ft) * 100;
        
        errors.push(errorPercent);
        absoluteErrors.push(error);
        
        if (errorPercent <= 2.0) {
            accurateCount++;
        }
    }
    
    const meanError = errors.reduce((a, b) => a + b, 0) / errors.length;
    const maxError = Math.max(...errors);
    const rmse = Math.sqrt(absoluteErrors.reduce((sum, e) => sum + e * e, 0) / absoluteErrors.length);
    const accuracy = accurateCount / REPORT_ROCKET_DATA.length;
    
    return {
        params: params,
        meanError,
        maxError,
        rmse,
        accuracy
    };
}

/**
 * Get mass-adjusted Cd correction based on optimized parameters
 */
export function getMassAdjustedCdCorrection(mass_g: number, baseCorrection: number): number {
    // Use optimized parameters
    const optimized = optimizeCalibrationParams();
    
    let multiplier = 1.0;
    
    if (mass_g < 580) {
        multiplier = optimized.massAdjustments.veryLight;
    } else if (mass_g < 600) {
        multiplier = optimized.massAdjustments.light;
    } else if (mass_g < 640) {
        multiplier = optimized.massAdjustments.medium;
    } else if (mass_g < 660) {
        multiplier = optimized.massAdjustments.heavy;
    } else {
        multiplier = optimized.massAdjustments.veryHeavy;
    }
    
    return baseCorrection * multiplier;
}










