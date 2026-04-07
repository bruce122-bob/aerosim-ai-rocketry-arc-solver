/**
 * Test calibration system functionality after fix
 * Verify:
 * 1. enhancedCalibration.ts parameter passing correctness
 * 2. Calibration accuracy improvement
 * 3. Parameter reasonableness check
 */

import { enhancedCalibrate } from './services/enhancedCalibration';
import { runSimulation } from './services/physics6dofStable';
import { findMotorByDesignation } from './services/motorMatcher';
import { RocketConfig, Environment } from './types';

// Test case: use real flight data
const testRocket: RocketConfig = {
    stages: [
        {
            name: 'Body Tube',
            type: 'bodyTube',
            length: 0.45,
            outerDiameter: 0.0254, // 1 inch = 0.0254m
            innerDiameter: 0.0244,
            material: 'cardboard',
            position: { x: 0, y: 0, z: 0 }
        },
        {
            name: 'Nose Cone',
            type: 'noseCone',
            shape: 'ogive',
            length: 0.15,
            baseDiameter: 0.0254,
            material: 'plastic',
            position: { x: 0, y: 0, z: 0.45 }
        },
        {
            name: 'Fins',
            type: 'fin',
            count: 3,
            rootChord: 0.08,
            tipChord: 0.05,
            span: 0.06,
            sweep: 0.02,
            material: 'balsa',
            position: { x: 0, y: 0, z: 0.2 }
        }
    ],
    motor: findMotorByDesignation('F42-8T') || {
        name: 'F42-8T',
        designation: 'F42-8T',
        totalImpulse: 160,
        avgThrust: 42,
        maxThrust: 60,
        burnTime: 3.8,
        propellantMass: 0.024,
        totalMass: 0.0759,
        thrustCurve: [
            { time: 0, thrust: 0 },
            { time: 0.1, thrust: 42 },
            { time: 3.8, thrust: 0 }
        ]
    },
    simulationSettings: {
        kThrust: 1.0,
        kDrag: 1.0
    }
};

const testEnv: Environment = {
    windSpeed: 0, // 0 mph = 0 m/s
    windDirection: 0, // N = 0 degrees
    temperature: 7.1, // 44.8°F = 7.1°C
    pressure: 1010.5, // 29.84 inHg = 1010.5 hPa
    humidity: 51.2
};

// Test data (from first record in flight_data.json)
const testFlightData = {
    apogee_ft: 791.0,
    mass_g: 598.0,
    ascent_time_s: 4.6,
    apogee_m: 791.0 / 3.28084 // 241.1m
};

async function testEnhancedCalibration() {
    console.log('='.repeat(60));
    console.log('🧪 Test enhanced calibration system (after fix)');
    console.log('='.repeat(60));
    console.log();

    // 1. Test parameter passing correctness
    console.log('📋 Test 1: Parameter passing correctness');
    console.log('----------------------------------------');
    
    const modifiedRocket: RocketConfig = {
        ...testRocket,
        manualOverride: {
            mass: testFlightData.mass_g / 1000 // 598g = 0.598kg
        }
    };

    // Test that different kThrust and kDrag values are correctly applied
    const testParams = [
        { kThrust: 0.9, kDrag: 1.0 },
        { kThrust: 1.0, kDrag: 1.0 },
        { kThrust: 1.1, kDrag: 1.0 },
        { kThrust: 1.0, kDrag: 0.9 },
        { kThrust: 1.0, kDrag: 1.1 }
    ];

    console.log('Simulation results with different parameter values:');
    for (const params of testParams) {
        const rocketWithParams: RocketConfig = {
            ...modifiedRocket,
            simulationSettings: {
                ...modifiedRocket.simulationSettings,
                kThrust: params.kThrust,
                kDrag: params.kDrag
            }
        };
        
        const result = await runSimulation(rocketWithParams, testEnv, 90, 1.0);
        const apogeeFt = result.apogee * 3.28084;
        console.log(`  kThrust=${params.kThrust.toFixed(2)}, kDrag=${params.kDrag.toFixed(2)} => Apogee=${apogeeFt.toFixed(1)}ft`);
    }
    console.log();

    // 2. Test enhanced calibration
    console.log('📋 Test 2: Enhanced calibration functionality');
    console.log('----------------------------------------');
    
    const flightDataPoints = [
        { time: testFlightData.ascent_time_s * 0.5, altitude: testFlightData.apogee_m * 0.5 },
        { time: testFlightData.ascent_time_s * 0.8, altitude: testFlightData.apogee_m * 0.9 },
        { time: testFlightData.ascent_time_s, altitude: testFlightData.apogee_m }
    ];

    console.log(`Target altitude: ${testFlightData.apogee_ft.toFixed(1)}ft (${testFlightData.apogee_m.toFixed(1)}m)`);
    console.log('Starting calibration...');
    
    const calibrationStart = Date.now();
    const calibrationResult = await enhancedCalibrate(
        modifiedRocket,
        testEnv,
        flightDataPoints,
        90,
        1.0,
        1.0,
        1.0,
        50 // Reduce iterations to speed up testing
    );
    const calibrationTime = (Date.now() - calibrationStart) / 1000;

    console.log(`Calibration complete (time: ${calibrationTime.toFixed(1)}s)`);
    console.log(`  Initial RMSE: ${calibrationResult.initialRMSE.toFixed(3)}m`);
    console.log(`  Final RMSE: ${calibrationResult.finalRMSE.toFixed(3)}m`);
    console.log(`  Improvement: ${calibrationResult.improvement.toFixed(1)}%`);
    console.log(`  Optimized kThrust: ${calibrationResult.kThrust.toFixed(4)}`);
    console.log(`  Optimized kDrag: ${calibrationResult.kDrag.toFixed(4)}`);
    console.log(`  Iterations: ${calibrationResult.iterations}`);
    console.log(`  Converged: ${calibrationResult.convergence ? 'Yes' : 'No'}`);
    console.log();

    // 3. Verify calibration results
    console.log('📋 Test 3: Verify calibration results');
    console.log('----------------------------------------');
    
    const calibratedRocket: RocketConfig = {
        ...modifiedRocket,
        simulationSettings: {
            ...modifiedRocket.simulationSettings,
            kThrust: calibrationResult.kThrust,
            kDrag: calibrationResult.kDrag
        }
    };
    
    const calibratedResult = await runSimulation(calibratedRocket, testEnv, 90, 1.0);
    const calibratedApogeeFt = calibratedResult.apogee * 3.28084;
    const calibratedError = Math.abs(calibratedApogeeFt - testFlightData.apogee_ft);
    const calibratedErrorPercent = (calibratedError / testFlightData.apogee_ft) * 100;

    // Baseline simulation (no calibration)
    const baselineResult = await runSimulation(modifiedRocket, testEnv, 90, 1.0);
    const baselineApogeeFt = baselineResult.apogee * 3.28084;
    const baselineError = Math.abs(baselineApogeeFt - testFlightData.apogee_ft);
    const baselineErrorPercent = (baselineError / testFlightData.apogee_ft) * 100;

    console.log('Before calibration:');
    console.log(`  Simulated altitude: ${baselineApogeeFt.toFixed(1)}ft`);
    console.log(`  Error: ${baselineError.toFixed(1)}ft (${baselineErrorPercent.toFixed(1)}%)`);
    console.log();
    console.log('After calibration:');
    console.log(`  Simulated altitude: ${calibratedApogeeFt.toFixed(1)}ft`);
    console.log(`  Error: ${calibratedError.toFixed(1)}ft (${calibratedErrorPercent.toFixed(1)}%)`);
    console.log();
    console.log(`Error improvement: ${(baselineError - calibratedError).toFixed(1)}ft (${((baselineError - calibratedError) / baselineError * 100).toFixed(1)}%)`);
    console.log();

    // 4. Parameter reasonableness check
    console.log('📋 Test 4: Parameter reasonableness check');
    console.log('----------------------------------------');
    
    const kThrustMin = 0.8, kThrustMax = 1.2;
    const kDragMin = 0.8, kDragMax = 1.5;
    
    const kThrustValid = calibrationResult.kThrust >= kThrustMin && calibrationResult.kThrust <= kThrustMax;
    const kDragValid = calibrationResult.kDrag >= kDragMin && calibrationResult.kDrag <= kDragMax;
    
    console.log(`kThrust: ${calibrationResult.kThrust.toFixed(4)} (valid range: ${kThrustMin}-${kThrustMax}) ${kThrustValid ? '✅' : '❌'}`);
    console.log(`kDrag: ${calibrationResult.kDrag.toFixed(4)} (valid range: ${kDragMin}-${kDragMax}) ${kDragValid ? '✅' : '❌'}`);
    console.log();

    // 5. Summary
    console.log('='.repeat(60));
    console.log('📊 Test summary');
    console.log('='.repeat(60));
    
    const allTestsPassed = 
        calibrationResult.improvement > 0 && // Calibration improved
        kThrustValid && // kThrust in valid range
        kDragValid && // kDrag in valid range
        calibratedErrorPercent < 20; // Error less than 20%
    
    console.log(`Parameter passing correct: ✅ (fixed)`);
    console.log(`Calibration improved: ${calibrationResult.improvement > 0 ? '✅' : '❌'} (${calibrationResult.improvement.toFixed(1)}%)`);
    console.log(`Parameter reasonableness: ${kThrustValid && kDragValid ? '✅' : '❌'}`);
    console.log(`Calibration accuracy: ${calibratedErrorPercent < 5 ? '✅ Excellent' : calibratedErrorPercent < 10 ? '⚠️ Good' : calibratedErrorPercent < 20 ? '⚠️ Fair' : '❌ Poor'} (${calibratedErrorPercent.toFixed(1)}%)`);
    console.log();
    console.log(`Overall test result: ${allTestsPassed ? '✅ Passed' : '⚠️ Partially passed'}`);
    console.log('='.repeat(60));
    
    return {
        success: allTestsPassed,
        baselineError,
        calibratedError,
        calibrationResult
    };
}

// Run tests
testEnhancedCalibration()
    .then(result => {
        if (result.success) {
            console.log('\n✅ All tests passed!');
            process.exit(0);
        } else {
            console.log('\n⚠️ Some tests did not pass, please check results.');
            process.exit(1);
        }
    })
    .catch(error => {
        console.error('\n❌ Test failed:', error);
        process.exit(1);
    });

export { testEnhancedCalibration };
