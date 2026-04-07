/**
 * Automated simulator accuracy test
 * Uses 5 rocket data from report to validate simulation accuracy
 */

import { runSimulation, DEFAULT_PHYSICS_CONFIG } from './services/physics6dof';
import { REPORT_ROCKET_DATA, validateSimulationAccuracy } from './services/enhancedCalibrationFromReport';
import { RocketConfig, Environment } from './types';
import { findMotorByDesignation } from './services/motorMatcher';

// Create test rocket config
const createTestRocket = (mass_g: number, motorName?: string, cdOverride: number = 0.55): RocketConfig => {
    const motor = motorName ? findMotorByDesignation(motorName) : null;
    
    // If motor not found, use F42-6T as default
    const defaultMotor = {
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
        motor: motor || defaultMotor,
        cdOverride: cdOverride,
        manualOverride: {
            mass: mass_g / 1000, // Convert to kg
            diameter: 0.029, // 29mm typical
            cdOverride: cdOverride
        }
    };
};

// Standard environment (no wind, standard atmosphere)
const standardEnv: Environment = {
    windSpeed: 0,
    windDirection: 0,
    temperature: 20,
    pressure: 1013.25,
    humidity: 50,
    airDensity: undefined
};

interface TestResult {
    rocketName: string;
    actualApogee_ft: number;
    simulatedApogee_ft: number;
    error_ft: number;
    errorPercent: number;
    mass_g: number;
    motor?: string;
    isAccurate: boolean;
}

// Run all tests
async function runAllTests(): Promise<TestResult[]> {
    console.log('🧪 ====== Starting automated simulator accuracy test ======\n');
    console.log(`📊 Test data: ${REPORT_ROCKET_DATA.length} rockets (2025 ≤650g rule compliant)\n`);
    
    const results: TestResult[] = [];
    
    for (const rocketData of REPORT_ROCKET_DATA) {
        console.log(`\n📊 Test: ${rocketData.name}`);
        console.log(`   Actual altitude: ${rocketData.avgApogee_ft.toFixed(1)}ft`);
        console.log(`   Mass: ${rocketData.avgMass_g.toFixed(1)}g`);
        console.log(`   Motor: ${rocketData.motor || 'Unknown'}`);
        
    // Create test rocket
    // If motor not specified, use F42-6T as default (most rockets use it)
    const motorName = rocketData.motor || 'F42-6T';
    const rocket = createTestRocket(rocketData.avgMass_g, motorName);
        
        // Run simulation (wait for completion)
        const result = await runSimulation(
            rocket,
            standardEnv,
            90, // Vertical launch
            1.0, // 1m rail
            DEFAULT_PHYSICS_CONFIG
        );
        
        const simulatedApogee_ft = result.apogee * 3.28084;
        
        // Check result validity
        if (isNaN(simulatedApogee_ft) || simulatedApogee_ft <= 0) {
            console.warn(`   ⚠️ Simulation failed: returned invalid altitude`);
            continue;
        }
        const error_ft = simulatedApogee_ft - rocketData.avgApogee_ft;
        const errorPercent = (error_ft / rocketData.avgApogee_ft) * 100;
        
        // Validate accuracy
        const validation = validateSimulationAccuracy(
            simulatedApogee_ft,
            rocketData.avgApogee_ft,
            rocketData.avgMass_g,
            rocketData.motor
        );
        
        results.push({
            rocketName: rocketData.name,
            actualApogee_ft: rocketData.avgApogee_ft,
            simulatedApogee_ft,
            error_ft,
            errorPercent,
            mass_g: rocketData.avgMass_g,
            motor: rocketData.motor,
            isAccurate: validation.isAccurate
        });
        
        console.log(`   Simulated altitude: ${simulatedApogee_ft.toFixed(1)}ft`);
        console.log(`   Error: ${error_ft > 0 ? '+' : ''}${error_ft.toFixed(1)}ft (${errorPercent > 0 ? '+' : ''}${errorPercent.toFixed(1)}%)`);
        
        if (Math.abs(errorPercent) <= 2.0) {
            console.log(`   ✅✅✅ Nearly perfect! Error ≤ 2%`);
        } else if (Math.abs(errorPercent) <= 5.0) {
            console.log(`   ✅✅ Excellent! Error ≤ 5%`);
        } else {
            console.log(`   ⚠️ Needs improvement! Error > 5%`);
            if (validation.recommendations.length > 0) {
                console.log(`   Recommendation: ${validation.recommendations[0]}`);
            }
        }
    }
    
    return results;
}

// Analyze results
function analyzeResults(results: TestResult[]): void {
    console.log('\n\n📈 ====== Test Results Analysis ======\n');
    
    // Compute statistics
    const errors = results.map(r => Math.abs(r.errorPercent));
    const meanError = errors.reduce((a, b) => a + b, 0) / errors.length;
    const maxError = Math.max(...errors);
    const minError = Math.min(...errors);
    const medianError = errors.sort((a, b) => a - b)[Math.floor(errors.length / 2)];
    
    // Compute RMSE
    const rmse = Math.sqrt(
        results.reduce((sum, r) => sum + Math.pow(r.error_ft, 2), 0) / results.length
    );
    
    // Compute MAE (Mean Absolute Error)
    const mae = errors.reduce((a, b) => a + b, 0) / errors.length;
    
    console.log(`📊 Statistics:`);
    console.log(`   Mean Absolute Error (MAE): ${mae.toFixed(2)}%`);
    console.log(`   Median error: ${medianError.toFixed(2)}%`);
    console.log(`   Max error: ${maxError.toFixed(2)}%`);
    console.log(`   Min error: ${minError.toFixed(2)}%`);
    console.log(`   RMSE: ${rmse.toFixed(1)}ft`);
    
    // Group by error
    const perfect = results.filter(r => Math.abs(r.errorPercent) <= 2.0);
    const excellent = results.filter(r => Math.abs(r.errorPercent) > 2.0 && Math.abs(r.errorPercent) <= 5.0);
    const needsImprovement = results.filter(r => Math.abs(r.errorPercent) > 5.0);
    
    console.log(`\n📊 Accuracy distribution:`);
    console.log(`   Nearly perfect (≤2%): ${perfect.length}/${results.length} (${(perfect.length/results.length*100).toFixed(0)}%)`);
    console.log(`   Excellent (2-5%): ${excellent.length}/${results.length} (${(excellent.length/results.length*100).toFixed(0)}%)`);
    console.log(`   Needs improvement (>5%): ${needsImprovement.length}/${results.length} (${(needsImprovement.length/results.length*100).toFixed(0)}%)`);
    
    if (perfect.length > 0) {
        console.log(`\n✅ Nearly perfect rockets:`);
        perfect.forEach(r => {
            console.log(`   ${r.rocketName}: ${r.errorPercent > 0 ? '+' : ''}${r.errorPercent.toFixed(1)}%`);
        });
    }
    
    if (needsImprovement.length > 0) {
        console.log(`\n⚠️ Rockets needing improvement:`);
        needsImprovement.forEach(r => {
            console.log(`   ${r.rocketName}: ${r.errorPercent > 0 ? '+' : ''}${r.errorPercent.toFixed(1)}% (${r.mass_g.toFixed(1)}g)`);
        });
    }
    
    // Check for systematic bias
    const avgError = results.reduce((sum, r) => sum + r.errorPercent, 0) / results.length;
    if (Math.abs(avgError) > 2.0) {
        console.log(`\n⚠️ Systematic bias detected: ${avgError > 0 ? '+' : ''}${avgError.toFixed(1)}%`);
        if (avgError > 0) {
            console.log(`   Recommendation: Increase Cd correction by ~${(avgError/10).toFixed(3)}`);
        } else {
            console.log(`   Recommendation: Decrease Cd correction by ~${(Math.abs(avgError)/10).toFixed(3)}`);
        }
    } else {
        console.log(`\n✅ No systematic bias (avg error: ${avgError > 0 ? '+' : ''}${avgError.toFixed(1)}%)`);
    }
    
    // Mass-error correlation analysis
    console.log(`\n📊 Mass-error correlation analysis:`);
    const massErrors = results.map(r => ({ mass: r.mass_g, error: r.errorPercent }));
    const correlation = calculateCorrelation(
        massErrors.map(m => m.mass),
        massErrors.map(m => m.error)
    );
    console.log(`   Correlation coefficient: ${correlation.toFixed(3)}`);
    if (Math.abs(correlation) > 0.5) {
        console.log(`   ⚠️ Mass-error correlation detected, may need mass-dependent calibration`);
    } else {
        console.log(`   ✅ Weak mass-error correlation, calibration is good`);
    }
    
    // Overall assessment
    console.log(`\n🎯 Overall assessment:`);
    if (meanError <= 2.0 && perfect.length >= results.length * 0.7) {
        console.log(`   ✅✅✅ Nearly perfect! Mean error ≤ 2%, 70%+ rockets error ≤ 2%`);
    } else if (meanError <= 3.0 && (perfect.length + excellent.length) >= results.length * 0.8) {
        console.log(`   ✅✅ Excellent! Mean error ≤ 3%, 80%+ rockets error ≤ 5%`);
    } else if (meanError <= 5.0) {
        console.log(`   ✅ Good! Mean error ≤ 5%`);
    } else {
        console.log(`   ⚠️ Needs improvement! Mean error > 5%`);
    }
}

function calculateCorrelation(x: number[], y: number[]): number {
    const n = x.length;
    const meanX = x.reduce((a, b) => a + b, 0) / n;
    const meanY = y.reduce((a, b) => a + b, 0) / n;
    
    let numerator = 0;
    let sumX2 = 0;
    let sumY2 = 0;
    
    for (let i = 0; i < n; i++) {
        const dx = x[i] - meanX;
        const dy = y[i] - meanY;
        numerator += dx * dy;
        sumX2 += dx * dx;
        sumY2 += dy * dy;
    }
    
    const denominator = Math.sqrt(sumX2 * sumY2);
    return denominator === 0 ? 0 : numerator / denominator;
}

// Main function
async function main() {
    try {
        console.log('🚀 Starting automated test...\n');
        const results = await runAllTests();
        analyzeResults(results);
        
        console.log('\n\n✅ ====== Test complete ======');
        console.log('Review results above to evaluate simulator accuracy\n');
    } catch (error) {
        console.error('❌ Test failed:', error);
        throw error;
    }
}

// If running this script directly
main().catch(console.error);

export { runAllTests, analyzeResults };

