/**
 * 🔄 6DOF Migration Tool
 * 
 * Automatically converts ORK data and legacy 6DOF config to the new stable format
 */

import type { RocketConfig, Environment, LaunchParams } from './physics6dofStable';

/**
 * Convert ORK parser output to stable 6DOF config
 */
export function convertOrkToStableConfig(orkData: any): RocketConfig {
  // Basic geometry parameters
  const bodyDiameter = orkData.body?.diameter || 0.05;  // default 50mm
  const bodyLength = orkData.length || 0.5;              // default 500mm
  
  // Reference area (circular cross-section)
  const refArea = Math.PI * Math.pow(bodyDiameter / 2, 2);
  
  // Center of gravity and center of pressure (measured from nose)
  const cg = orkData.cg?.x || bodyLength * 0.5;         // default at center
  const cp = orkData.cp?.x || bodyLength * 0.7;         // default at aft (stable)
  
  // Mass properties
  const totalMass = orkData.mass?.total || 0.15;        // default 150g
  const propellantMass = orkData.motor?.propellantMass || 0.024;  // default 24g
  const dryMass = totalMass - propellantMass;
  
  // Inertia moment estimate (based on cylinder model)
  // Ixx = Iyy ≈ m * (3*r² + L²) / 12  (transverse)
  // Izz ≈ m * r² / 2                    (axial)
  const r = bodyDiameter / 2;
  const L = bodyLength;
  const Ixx = totalMass * (3 * r * r + L * L) / 12;
  const Izz = totalMass * r * r / 2;
  
  // Aerodynamic parameters
  const baseCd = orkData.aerodynamics?.cd || 0.45;      // default drag coefficient
  
  // Motor parameters
  const motorBurnTime = orkData.motor?.burnTime || 1.5; // default 1.5s
  const thrustCurve = orkData.motor?.thrustCurve || [
    { time: 0, thrust: 0 },
    { time: 0.1, thrust: 5 },
    { time: motorBurnTime, thrust: 0 }
  ];
  
  // Parachute parameters
  const parachuteDiameter = orkData.parachute?.diameter || 0.45;  // default 45cm
  const parachuteCd = orkData.parachute?.cd || 1.5;                // standard circular chute
  
  return {
    // Aerodynamic parameters
    baseCd,
    refArea,
    referenceLength: bodyLength,
    
    // Center of gravity and center of pressure
    cg,
    cp,
    
    // Inertia moments
    Ixx,
    Izz,
    
    // Mass parameters
    dryMass,
    propellantMass,
    motorCasingMass: (orkData.motor?.totalMass || 0) - (orkData.motor?.propellantMass || 0),
    
    // Motor parameters
    motorBurnTime,
    motorDelayTime: orkData.motor?.delayTime || 0,
    thrustCurve,
    
    // Parachute parameters
    parachuteDiameter,
    parachuteCd
  };
}

/**
 * Convert from legacy 6DOF config (if you already have a config)
 */
export function convertOldConfigToStable(oldConfig: any): RocketConfig {
  return {
    baseCd: oldConfig.baseCd || oldConfig.cd || 0.45,
    refArea: oldConfig.refArea || oldConfig.referenceArea || 0.002,
    referenceLength: oldConfig.referenceLength || oldConfig.length || 0.5,
    
    cg: oldConfig.cg || 0.25,
    cp: oldConfig.cp || 0.4,
    
    Ixx: oldConfig.Ixx || oldConfig.inertiaTransverse || 0.001,
    Izz: oldConfig.Izz || oldConfig.inertiaAxial || 0.0001,
    
    dryMass: oldConfig.dryMass || oldConfig.massEmpty || 0.1,
    propellantMass: oldConfig.propellantMass || oldConfig.motorMass || 0.024,
    motorCasingMass: oldConfig.motorCasingMass || 0,
    
    motorBurnTime: oldConfig.motorBurnTime || oldConfig.burnTime || 1.5,
    motorDelayTime: oldConfig.motorDelayTime || 0,
    thrustCurve: oldConfig.thrustCurve || oldConfig.thrust || [],
    
    parachuteDiameter: oldConfig.parachuteDiameter || oldConfig.chuteDiameter || 0.45,
    parachuteCd: oldConfig.parachuteCd || oldConfig.chuteCd || 1.5
  };
}

/**
 * Validate config completeness and reasonableness
 */
export function validateConfig(config: RocketConfig): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Required field checks
  if (!config.baseCd || config.baseCd <= 0) {
    errors.push('Base drag coefficient (baseCd) must be > 0');
  }
  
  if (!config.refArea || config.refArea <= 0) {
    errors.push('Reference area (refArea) must be > 0');
  }
  
  if (!config.referenceLength || config.referenceLength <= 0) {
    errors.push('Reference length (referenceLength) must be > 0');
  }
  
  // Center of gravity and center of pressure checks
  if (config.cp <= config.cg) {
    errors.push(`Center of pressure (${config.cp}m) must be behind center of gravity (${config.cg}m), otherwise rocket is unstable!`);
  }
  
  const stabilityMargin = (config.cp - config.cg) / config.referenceLength;
  if (stabilityMargin < 0.1) {
    warnings.push(`Stability margin too small (${(stabilityMargin * 100).toFixed(1)}%), recommend > 10%`);
  } else if (stabilityMargin > 2.0) {
    warnings.push(`Stability margin too large (${(stabilityMargin * 100).toFixed(1)}%), may be over-stable`);
  }
  
  // Inertia moment checks
  if (!config.Ixx || config.Ixx <= 0) {
    errors.push('Transverse moment of inertia (Ixx) must be > 0');
  }
  
  if (!config.Izz || config.Izz <= 0) {
    errors.push('Axial moment of inertia (Izz) must be > 0');
  }
  
  if (config.Ixx < config.Izz) {
    warnings.push('Transverse inertia < axial inertia, uncommon for slender rockets');
  }
  
  // Mass checks
  if (!config.dryMass || config.dryMass <= 0) {
    errors.push('Dry mass (dryMass) must be > 0');
  }
  
  if (!config.propellantMass || config.propellantMass < 0) {
    errors.push('Propellant mass (propellantMass) must be >= 0');
  }
  
  const totalMass = config.dryMass + config.propellantMass;
  if (totalMass < 0.01) {
    warnings.push('Total mass < 10g, too light for a real rocket');
  } else if (totalMass > 10) {
    warnings.push('Total mass > 10kg, exceeds model rocket range');
  }
  
  // Motor checks
  if (!config.motorBurnTime || config.motorBurnTime <= 0) {
    errors.push('Motor burn time (motorBurnTime) must be > 0');
  }
  
  if (!config.thrustCurve || config.thrustCurve.length < 2) {
    errors.push('Thrust curve (thrustCurve) needs at least 2 points');
  }
  
  // Parachute checks
  if (!config.parachuteDiameter || config.parachuteDiameter <= 0) {
    errors.push('Parachute diameter (parachuteDiameter) must be > 0');
  }
  
  if (config.parachuteCd && (config.parachuteCd < 0.5 || config.parachuteCd > 2.5)) {
    warnings.push(`Parachute drag coefficient (${config.parachuteCd}) outside common range (0.5-2.5)`);
  }
  
  // Calculate terminal velocity (parachute)
  const parachuteArea = Math.PI * Math.pow(config.parachuteDiameter / 2, 2);
  const terminalVelocity = Math.sqrt(
    (2 * config.dryMass * 9.81) / (1.225 * config.parachuteCd * parachuteArea)
  );
  
  if (terminalVelocity > 10) {
    warnings.push(
      `Landing velocity too high (${terminalVelocity.toFixed(1)}m/s), ` +
      `recommend larger parachute or reduced mass`
    );
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Generate config summary (for debugging)
 */
export function printConfigSummary(config: RocketConfig): void {
  console.log('='.repeat(60));
  console.log('📋 Rocket Config Summary');
  console.log('='.repeat(60));
  
  // Geometry parameters
  const diameter = Math.sqrt(config.refArea / Math.PI) * 2;
  console.log('');
  console.log('🔷 Geometry:');
  console.log(`  Diameter: ${(diameter * 1000).toFixed(1)}mm`);
  console.log(`  Length: ${(config.referenceLength * 1000).toFixed(1)}mm`);
  console.log(`  Reference area: ${(config.refArea * 10000).toFixed(2)}cm²`);
  
  // Mass properties
  const totalMass = config.dryMass + config.propellantMass;
  console.log('');
  console.log('⚖️  Mass Properties:');
  console.log(`  Total mass: ${(totalMass * 1000).toFixed(1)}g`);
  console.log(`  Dry mass: ${(config.dryMass * 1000).toFixed(1)}g`);
  console.log(`  Propellant: ${(config.propellantMass * 1000).toFixed(1)}g`);
  console.log(`  Propellant fraction: ${(config.propellantMass / totalMass * 100).toFixed(1)}%`);
  
  // Stability
  const stabilityMargin = (config.cp - config.cg) / config.referenceLength;
  const stabilityCaliber = (config.cp - config.cg) / diameter;
  console.log('');
  console.log('🎯 Stability:');
  console.log(`  Center of gravity (CG): ${(config.cg * 1000).toFixed(1)}mm`);
  console.log(`  Center of pressure (CP): ${(config.cp * 1000).toFixed(1)}mm`);
  console.log(`  CP - CG: ${((config.cp - config.cg) * 1000).toFixed(1)}mm`);
  console.log(`  Stability margin: ${(stabilityMargin * 100).toFixed(1)}% (${stabilityCaliber.toFixed(2)} caliber)`);
  
  if (stabilityCaliber >= 1.0) {
    console.log(`  Status: ✅ Stable (recommended range: 1-2 caliber)`);
  } else {
    console.log(`  Status: ⚠️  Unstable (need >= 1 caliber)`);
  }
  
  // Inertia moments
  console.log('');
  console.log('🔄 Moments of Inertia:');
  console.log(`  Ixx (transverse): ${(config.Ixx * 1000).toFixed(3)}g⋅m²`);
  console.log(`  Izz (axial): ${(config.Izz * 1000).toFixed(3)}g⋅m²`);
  console.log(`  Ratio Ixx/Izz: ${(config.Ixx / config.Izz).toFixed(1)}`);
  
  // Aerodynamic parameters
  console.log('');
  console.log('🌬️  Aerodynamics:');
  console.log(`  Base drag coefficient: ${config.baseCd.toFixed(3)}`);
  
  // Motor
  const avgThrust = config.thrustCurve.reduce((sum, p) => sum + p.thrust, 0) / config.thrustCurve.length;
  const totalImpulse = avgThrust * config.motorBurnTime;
  console.log('');
  console.log('🚀 Motor:');
  console.log(`  Burn time: ${config.motorBurnTime.toFixed(2)}s`);
  console.log(`  Average thrust: ${avgThrust.toFixed(1)}N`);
  console.log(`  Total impulse: ${totalImpulse.toFixed(1)}N⋅s`);
  
  // Parachute
  const parachuteArea = Math.PI * Math.pow(config.parachuteDiameter / 2, 2);
  const terminalVelocity = Math.sqrt(
    (2 * config.dryMass * 9.81) / (1.225 * config.parachuteCd * parachuteArea)
  );
  console.log('');
  console.log('🪂 Parachute:');
  console.log(`  Diameter: ${(config.parachuteDiameter * 100).toFixed(1)}cm`);
  console.log(`  Drag coefficient: ${config.parachuteCd.toFixed(2)}`);
  console.log(`  Area: ${(parachuteArea * 10000).toFixed(1)}cm²`);
  console.log(`  Estimated landing velocity: ${terminalVelocity.toFixed(1)}m/s`);
  
  if (terminalVelocity < 5) {
    console.log(`  Status: ✅ Very safe`);
  } else if (terminalVelocity < 8) {
    console.log(`  Status: ✅ Safe`);
  } else if (terminalVelocity < 12) {
    console.log(`  Status: ⚠️  Fast, watch landing`);
  } else {
    console.log(`  Status: ⚠️  Too fast, recommend larger parachute`);
  }
  
  console.log('');
  console.log('='.repeat(60));
}

/**
 * Create default environment config
 */
export function createDefaultEnvironment(): Environment {
  return {
    windSpeed: 0,
    windDirection: 0,
    humidity: 50,
    temperature: 20,
    pressure: 1013.25
  };
}

/**
 * Create default launch parameters
 */
export function createDefaultLaunchParams(): LaunchParams {
  return {
    railLength: 1.0,     // 1m launch rail
    launchAngle: 90      // vertical launch
  };
}

/**
 * Complete migration flow example
 */
export function migrateExample() {
  console.log('🔄 6DOF Migration Tool Example');
  console.log('');
  
  // Assume you have legacy config or ORK data
  const oldData = {
    cd: 0.45,
    referenceArea: 0.00196,
    length: 0.5,
    cg: 0.25,
    cp: 0.4,
    massTotal: 0.124,
    motorMass: 0.024,
    burnTime: 1.5,
    thrust: [
      { time: 0, thrust: 0 },
      { time: 0.1, thrust: 5 },
      { time: 1.5, thrust: 0 }
    ],
    chuteDiameter: 0.45
  };
  
  // Convert
  console.log('1️⃣ Converting config...');
  const config = convertOldConfigToStable(oldData);
  
  // Validate
  console.log('2️⃣ Validating config...');
  const validation = validateConfig(config);
  
  if (validation.errors.length > 0) {
    console.log('');
    console.log('❌ Errors found:');
    validation.errors.forEach(err => console.log(`  - ${err}`));
  }
  
  if (validation.warnings.length > 0) {
    console.log('');
    console.log('⚠️  Warnings:');
    validation.warnings.forEach(warn => console.log(`  - ${warn}`));
  }
  
  if (validation.valid) {
    console.log('');
    console.log('✅ Config validation passed!');
  }
  
  // Print summary
  console.log('');
  printConfigSummary(config);
  
  // Prepare simulation
  console.log('');
  console.log('3️⃣ Preparing simulation parameters...');
  const env = createDefaultEnvironment();
  const launch = createDefaultLaunchParams();
  
  console.log('');
  console.log('✅ Migration complete! You can run simulation with:');
  console.log('');
  console.log('```typescript');
  console.log('import { simulate6DOF } from "./services/physics6dofStable";');
  console.log('');
  console.log('const results = simulate6DOF(config, env, launch);');
  console.log('console.log(`Max altitude: ${Math.max(...results.map(p => p.altitude))}m`);');
  console.log('```');
}

// ============================================================================
// Exports
// ============================================================================

export type { RocketConfig, Environment, LaunchParams };
