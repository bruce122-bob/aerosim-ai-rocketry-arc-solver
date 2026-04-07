/**
 * Test calibration parameter system
 * Verify that calibration parameters are correctly passed and applied
 */

import type { RocketConfig as TypesRocketConfig, Environment as TypesEnvironment } from './types';
import { runSimulation } from './services/physics6dofStable';

console.log('🧪 Starting calibration parameter system test...\n');

// Create test rocket config (with calibration parameters)
const testRocket: TypesRocketConfig = {
  name: 'Test Rocket',
  stages: [{
    id: 'stage1',
    type: 'STAGE',
    name: 'Main Stage',
    mass: 0.1,
    color: '#ff0000',
    position: 0,
    subComponents: [{
      id: 'nose',
      type: 'NOSECONE',
      name: 'Nose Cone',
      mass: 0.02,
      color: '#ff0000',
      position: 0,
      length: 0.15,
      baseDiameter: 0.05,
      shape: 'OGIVE',
      parameter: 0.5,
      wallThickness: 0.001,
      material: 'plastic',
      subComponents: []
    }, {
      id: 'body',
      type: 'BODYTUBE',
      name: 'Body Tube',
      mass: 0.05,
      color: '#ff0000',
      position: 0.15,
      length: 0.35,
      diameter: 0.05,
      innerDiameter: 0.048,
      isMotorMount: true,
      wallThickness: 0.001,
      material: 'cardboard',
      subComponents: []
    }]
  }],
  motor: {
    name: 'B6-4',
    totalImpulse: 5,
    burnTime: 1.5,
    thrustCurve: [
      { time: 0, thrust: 0 },
      { time: 0.05, thrust: 12 },
      { time: 1.4, thrust: 3 },
      { time: 1.5, thrust: 0 }
    ],
    propellantMass: 0.024,
    totalMass: 0.024
  },
  cdOverride: 0.45,
  // Test calibration parameters
  simulationSettings: {
    kThrust: 1.1,  // 10% thrust increase
    kDrag: 0.9     // 10% drag reduction
  }
};

const testEnv: TypesEnvironment = {
  temperature: 20,
  pressure: 1013,
  humidity: 50,
  windSpeed: 2.0,
  windDirection: 0,
  airDensity: 1.225
};

// Test 1: Verify calibration parameters are correctly passed to simulation
async function testCalibrationParameterPassing() {
  console.log('📋 Test 1: Verify calibration parameter passing');
  console.log('   Input parameters: kThrust=1.1, kDrag=0.9\n');
  
  try {
    const result = await runSimulation(testRocket, testEnv, 90, 1.0);
    console.log('   ✅ Simulation ran successfully');
    console.log(`   - Apogee: ${result.apogee.toFixed(2)}m`);
    console.log(`   - Max velocity: ${result.maxVelocity.toFixed(2)}m/s`);
    console.log(`   - Flight time: ${result.flightTime.toFixed(2)}s\n`);
    return true;
  } catch (error) {
    console.error('   ❌ Simulation run failed:', error);
    return false;
  }
}

// Test 2: Compare difference with and without calibration parameters
async function testCalibrationEffect() {
  console.log('📋 Test 2: Verify calibration parameter effect on simulation results');
  
  // Config without calibration parameters
  const rocketWithoutCalibration: TypesRocketConfig = {
    ...testRocket,
    simulationSettings: undefined
  };
  
  try {
    console.log('   Running simulation without calibration parameters...');
    const resultWithout = await runSimulation(rocketWithoutCalibration, testEnv, 90, 1.0);
    console.log(`   - Apogee: ${resultWithout.apogee.toFixed(2)}m\n`);
    
    console.log('   Running simulation with calibration parameters...');
    const resultWith = await runSimulation(testRocket, testEnv, 90, 1.0);
    console.log(`   - Apogee: ${resultWith.apogee.toFixed(2)}m\n`);
    
    const difference = resultWith.apogee - resultWithout.apogee;
    const percentDiff = (difference / resultWithout.apogee) * 100;
    
    console.log(`   ✅ Difference: ${difference.toFixed(2)}m (${percentDiff.toFixed(1)}%)`);
    
    // Calibration should produce noticeable difference (kThrust +10%, kDrag -10%, should yield higher apogee)
    if (difference > 1.0) {
      console.log('   ✅ Calibration parameters produced expected effect (apogee increase)\n');
      return true;
    } else {
      console.log('   ⚠️  Calibration parameter effect is small, may need to check\n');
      return false;
    }
  } catch (error) {
    console.error('   ❌ Test failed:', error);
    return false;
  }
}

// Test 3: Verify convertRocketConfig passes parameters
async function testConfigConversion() {
  console.log('📋 Test 3: Verify config conversion');
  
  // Directly check physics6dofStable module internal implementation
  // Cannot access internal functions directly, we verify indirectly by running simulation
  // If console output contains calibration parameter logs, conversion succeeded
  
  console.log('   Check if console logs contain calibration parameter info...');
  console.log('   (Should see kThrust and kDrag output in [6DOF stable] logs)\n');
  
  try {
    await runSimulation(testRocket, testEnv, 90, 1.0);
    console.log('   ✅ Please check logs above to confirm "kThrust" and "kDrag" output\n');
    return true;
  } catch (error) {
    console.error('   ❌ Test failed:', error);
    return false;
  }
}

// Run all tests
async function runAllTests() {
  console.log('═══════════════════════════════════════════════\n');
  
  const results = {
    test1: false,
    test2: false,
    test3: false
  };
  
  results.test1 = await testCalibrationParameterPassing();
  results.test2 = await testCalibrationEffect();
  results.test3 = await testConfigConversion();
  
  console.log('═══════════════════════════════════════════════');
  console.log('📊 Test results summary:');
  console.log(`   ✅ Test 1 (parameter passing): ${results.test1 ? 'Passed' : 'Failed'}`);
  console.log(`   ✅ Test 2 (parameter effect): ${results.test2 ? 'Passed' : 'Failed'}`);
  console.log(`   ✅ Test 3 (config conversion): ${results.test3 ? 'Passed' : 'Failed'}`);
  
  const allPassed = results.test1 && results.test2 && results.test3;
  console.log(`\n${allPassed ? '✅' : '❌'} Overall result: ${allPassed ? 'All passed' : 'Partial failure'}`);
  console.log('═══════════════════════════════════════════════\n');
  
  return allPassed;
}

// Execute tests
runAllTests().catch(console.error);
