/**
 * Test stable 6DOF physics engine
 */

import { simulate6DOF, PhysicsProfile, Environment, LaunchParams } from './services/physics6dofStable';

// Test config: simple model rocket
const testRocket: PhysicsProfile = {
  // Aerodynamic parameters
  baseCd: 0.45,
  refArea: Math.PI * Math.pow(0.025, 2),  // 50mm diameter
  maxDiameter: 0.050,  // 50mm
  referenceLength: 0.5,

  // Center of gravity and center of pressure
  cg: 0.250,   // CG at center
  cp: 0.400,   // CP at rear (stable config)

  // Moment of inertia (estimated)
  Ixx: 0.001,  // Lateral inertia
  Izz: 0.0001, // Axial inertia

  // Mass
  dryMass: 0.100,        // 100g dry mass
  propellantMass: 0.024, // 24g propellant
  motorCasingMass: 0.010, // 10g casing

  // Motor (B6-4 similar)
  motorBurnTime: 1.5,
  motorDelayTime: 4,
  thrustCurve: [
    { time: 0, thrust: 0 },
    { time: 0.05, thrust: 12 },
    { time: 0.2, thrust: 8 },
    { time: 1.0, thrust: 5 },
    { time: 1.4, thrust: 3 },
    { time: 1.5, thrust: 0 }
  ],

  // Parachute
  parachuteDiameter: 0.45,  // 45cm diameter
  parachuteCd: 1.5
};

const testEnv: Environment = {
  windSpeed: 2.0,
  windDirection: 45,  // NE wind
  humidity: 50,
  temperature: 20,
  pressure: 1013.25,
  airDensity: 1.225
};

const testLaunch: LaunchParams = {
  railLength: 1.0,      // 1m rail
  launchAngle: 85       // Near vertical (5° offset)
};

console.log('='.repeat(60));
console.log('🚀 Stable 6DOF physics engine test');
console.log('='.repeat(60));
console.log('');
console.log('Rocket config:');
console.log(`  Mass: ${(testRocket.dryMass + testRocket.propellantMass) * 1000}g`);
console.log(`  Diameter: ${Math.sqrt(testRocket.refArea / Math.PI) * 2 * 1000}mm`);
console.log(`  Length: ${testRocket.referenceLength * 1000}mm`);
console.log(`  CG: ${testRocket.cg * 1000}mm, CP: ${testRocket.cp * 1000}mm`);
console.log(`  Stability margin: ${((testRocket.cp - testRocket.cg) / testRocket.referenceLength * 100).toFixed(1)}% (caliber)`);
console.log('');
console.log('Environment:');
console.log(`  Wind speed: ${testEnv.windSpeed}m/s, Wind direction: ${testEnv.windDirection}°`);
console.log(`  Temperature: ${testEnv.temperature}°C, Humidity: ${testEnv.humidity}%`);
console.log('');
console.log('Launch parameters:');
console.log(`  Launch angle: ${testLaunch.launchAngle}°`);
console.log(`  Rail length: ${testLaunch.railLength}m`);
console.log('');
console.log('Starting simulation...');
console.log('='.repeat(60));
console.log('');

// Run simulation
const startTime = Date.now();
const results = simulate6DOF(testRocket, testEnv, testLaunch);
const endTime = Date.now();

console.log('');
console.log('='.repeat(60));
console.log('📊 Simulation results');
console.log('='.repeat(60));
console.log('');

// Analyze results
const maxAltitudePoint = results.reduce((max, p) => p.altitude > max.altitude ? p : max);
const maxSpeedPoint = results.reduce((max, p) => p.speed > max.speed ? p : max);
const maxMachPoint = results.reduce((max, p) => p.mach > max.mach ? p : max);
const landingPoint = results[results.length - 1];

console.log('Key performance metrics:');
console.log(`  Max altitude: ${maxAltitudePoint.altitude.toFixed(2)}m (t=${maxAltitudePoint.time.toFixed(2)}s)`);
console.log(`  Max speed: ${maxSpeedPoint.speed.toFixed(2)}m/s (t=${maxSpeedPoint.time.toFixed(2)}s)`);
console.log(`  Max Mach: ${maxMachPoint.mach.toFixed(3)} (t=${maxMachPoint.time.toFixed(2)}s)`);
console.log(`  Flight time: ${landingPoint.time.toFixed(2)}s`);
console.log(`  Landing distance: ${Math.sqrt(landingPoint.position.x ** 2 + landingPoint.position.y ** 2).toFixed(2)}m`);
console.log(`  Landing speed: ${landingPoint.speed.toFixed(2)}m/s`);
console.log('');

// Check numerical stability
let hasNaN = false;
let hasInf = false;
let maxPitch = -Infinity;
let minPitch = Infinity;

results.forEach(p => {
  if (isNaN(p.altitude) || isNaN(p.speed) || isNaN(p.pitch)) {
    hasNaN = true;
  }
  if (!isFinite(p.altitude) || !isFinite(p.speed) || !isFinite(p.pitch)) {
    hasInf = true;
  }
  maxPitch = Math.max(maxPitch, Math.abs(p.pitch));
  minPitch = Math.min(minPitch, p.pitch);
});

console.log('Numerical stability check:');
console.log(`  Contains NaN: ${hasNaN ? '❌ Yes' : '✅ No'}`);
console.log(`  Contains Inf: ${hasInf ? '❌ Yes' : '✅ No'}`);
console.log(`  Pitch range: ${minPitch.toFixed(1)}° ~ ${maxPitch.toFixed(1)}°`);
console.log(`  Data points: ${results.length}`);
console.log(`  Compute time: ${endTime - startTime}ms`);
console.log('');

// Check attitude stability
const pitchChanges = results.slice(1).map((p, i) =>
  Math.abs(p.pitch - results[i].pitch)
);
const maxPitchChange = Math.max(...pitchChanges);
const avgPitchChange = pitchChanges.reduce((a, b) => a + b, 0) / pitchChanges.length;

console.log('Attitude stability:');
console.log(`  Max single-step pitch change: ${maxPitchChange.toFixed(2)}°`);
console.log(`  Avg single-step pitch change: ${avgPitchChange.toFixed(3)}°`);

if (maxPitch < 1000 && !hasNaN && !hasInf) {
  console.log('');
  console.log('✅ Simulation succeeded! Attitude remains numerically stable.');
} else {
  console.log('');
  console.log('❌ Simulation has numerical issues!');
}

console.log('');
console.log('='.repeat(60));

// Output partial trajectory data (for debugging)
console.log('');
console.log('Partial trajectory data (first 10s, once per second):');
console.log('Time(s)  Altitude(m)  Velocity(m/s)  Pitch(°)  Mach');
console.log('-'.repeat(60));
for (let i = 0; i < Math.min(results.length, 500); i += 50) {
  const p = results[i];
  console.log(
    `${p.time.toFixed(2).padStart(6)}  ` +
    `${p.altitude.toFixed(1).padStart(7)}  ` +
    `${p.speed.toFixed(1).padStart(9)}  ` +
    `${p.pitch.toFixed(1).padStart(7)}  ` +
    `${p.mach.toFixed(3).padStart(6)}`
  );
}

console.log('');
console.log('Test complete!');
