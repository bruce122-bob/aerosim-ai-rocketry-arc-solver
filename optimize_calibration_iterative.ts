/**
 * Iterative calibration parameter optimization
 * Auto-adjust based on actual test results to achieve near-perfect accuracy
 */

import { REPORT_ROCKET_DATA } from './services/enhancedCalibrationFromReport';
import { runSimulation, DEFAULT_PHYSICS_CONFIG } from './services/physics6dof';
import { RocketConfig, Environment } from './types';
import { findMotorByDesignation } from './services/motorMatcher';

// Create test rocket
const createTestRocket = (mass_g: number, motorName: string): RocketConfig => {
    const motor = findMotorByDesignation(motorName) || {
        name: 'F42-6T',
        totalImpulse: 52.9,
        averageThrust: 42,
        maxThrust: 68,
        burnTime: 1.26,
        thrustCurve: [
            { time: 0.00, thrust: 0.0 },
            { time: 0.05, thrust: 55.0 },
            { time: 0.15, thrust: 68.0 },
            { time: 0.30, thrust: 58.0 },
            { time: 0.60, thrust: 48.0 },
            { time: 0.90, thrust: 38.0 },
            { time: 1.15, thrust: 28.0 },
            { time: 1.26, thrust: 0.0 }
        ],
        propellantMass: 0.027,
        totalMass: 0.080
    };
    
    return {
        name: 'Test Rocket',
        stages: [],
        motor: motor,
        cdOverride: 0.55,
        manualOverride: {
            mass: mass_g / 1000,
            diameter: 0.029,
            cdOverride: 0.55
        }
    };
};

const standardEnv: Environment = {
    windSpeed: 0,
    windDirection: 0,
    temperature: 20,
    pressure: 1013.25,
    humidity: 50,
    airDensity: undefined
};

/**
 * Test accuracy for given Cd correction coefficient
 */
async function testCdCorrection(baseCorrection: number): Promise<{
    meanError: number;
    maxError: number;
    results: Array<{ name: string; error: number }>;
}> {
    // Temporarily modify calibration function
    const originalCalculate = require('./services/enhancedCalibrationFromReport').calculateAverageCdCorrection;
    
    // Create temporary function
    const tempCalculate = (mass_g?: number) => {
        let correction = baseCorrection;
        if (mass_g !== undefined) {
            if (mass_g < 580) correction *= 0.95;
            else if (mass_g < 595) correction *= 0.97;
            else if (mass_g < 605) correction *= 0.99;
        }
        return correction;
    };
    
    // Replace function (temporary)
    require.cache[require.resolve('./services/enhancedCalibrationFromReport')].exports.calculateAverageCdCorrection = tempCalculate;
    
    const errors: number[] = [];
    const results: Array<{ name: string; error: number }> = [];
    
    for (const rocketData of REPORT_ROCKET_DATA) {
        const motorName = rocketData.motor || 'F42-6T';
        const rocket = createTestRocket(rocketData.avgMass_g, motorName);
        
        const result = await runSimulation(rocket, standardEnv, 90, 1.0, DEFAULT_PHYSICS_CONFIG);
        const simulatedApogee_ft = result.apogee * 3.28084;
        const errorPercent = Math.abs((simulatedApogee_ft - rocketData.avgApogee_ft) / rocketData.avgApogee_ft * 100);
        
        errors.push(errorPercent);
        results.push({ name: rocketData.name, error: errorPercent });
    }
    
    // Restore original function
    require.cache[require.resolve('./services/enhancedCalibrationFromReport')].exports.calculateAverageCdCorrection = originalCalculate;
    
    return {
        meanError: errors.reduce((a, b) => a + b, 0) / errors.length,
        maxError: Math.max(...errors),
        results
    };
}

/**
 * Iterative optimization to find best Cd correction coefficient
 */
async function optimizeCdCorrection(): Promise<number> {
    console.log('🔍 Starting iterative Cd correction optimization...\n');
    
    let bestCorrection = 1.40;
    let bestError = Infinity;
    
    // Test different base correction coefficients
    const testValues = [1.35, 1.40, 1.45, 1.50, 1.55, 1.60];
    
    for (const correction of testValues) {
        console.log(`Testing base correction: ${correction.toFixed(2)}`);
        const result = await testCdCorrection(correction);
        
        console.log(`  Mean error: ${result.meanError.toFixed(2)}%`);
        console.log(`  Max error: ${result.maxError.toFixed(2)}%`);
        
        if (result.meanError < bestError) {
            bestError = result.meanError;
            bestCorrection = correction;
            console.log(`  ✅ New best value!`);
        }
        console.log('');
    }
    
    console.log(`\n🎯 Best base correction: ${bestCorrection.toFixed(2)}`);
    console.log(`   Mean error: ${bestError.toFixed(2)}%`);
    
    return bestCorrection;
}

// Run optimization
optimizeCdCorrection().then(bestCorrection => {
    console.log(`\n✅ Optimization complete! Recommended base correction: ${bestCorrection.toFixed(2)}`);
}).catch(console.error);










