/**
 * 🚀 Stable 6DOF rocket flight physics engine
 * 
 * Core features:
 * - Vector attitude representation (no Euler angle singularities)
 * - Drag always opposes velocity
 * - Correct torque direction (CP-CG)
 * - Numerically stable integrator
 * - Angular velocity damping to prevent divergence
 * 
 * Author: Based on engineering-grade flight dynamics
 * Date: 2026-01-13
 */

import {
  RocketConfig,
  Environment,
  SimulationResult,
  SimulationPoint,
  MotorData,
  RocketComponent
} from '../types';
import { calculateDryMass, findMaxDiameter, calculateReferenceArea } from './rocketUtils';
import { calculateCG, calculateCP, resolveStabilityReferenceLength, extractCPGeometry, getCPAtMach, RocketGeometryForCP } from './stability';
import { sampleWindProfile, syncEnvironmentWindScalars } from './windField';

// ============================================================================
// Internal Physics Helpers (Restored from PhysicsCore)
// ============================================================================

// 1. Logging
enum LogLevel {
  SILENT = 0,
  ERROR = 1,
  WARN = 2,
  INFO = 3,
  DEBUG = 4,
}

let currentLogLevel = LogLevel.INFO;

const setLogLevel = (level: LogLevel): void => {
  currentLogLevel = level;
};

const physicsLog = (level: LogLevel, ...args: any[]): void => {
  if (level <= currentLogLevel) {
    if (level === LogLevel.ERROR) console.error(...args);
    else if (level === LogLevel.WARN) console.warn(...args);
    else console.log(...args);
  }
};

// 2. Constants
const G = 9.80665;           // Standard gravity [m/s²]
const R_GAS = 287.05;        // Specific gas constant for dry air [J/(kg·K)]
const R_VAPOR = 461.5;       // Specific gas constant for water vapor [J/(kg·K)]
const GAMMA = 1.4;           // Adiabatic index for air
const LAPSE_RATE = 0.0065;   // ISA temperature lapse rate [K/m]

// Simulation time step and limits
const DT = 0.02;                    // Integration time step [s] (50 Hz)
const MAX_SIMULATION_TIME = 300;    // Maximum simulation duration [s]
const GROUND_TOLERANCE = -0.05;     // Landing threshold [m]

// Aerodynamics coefficients
const CD_ALPHA_COEFF = 1.5;         // Angle-of-attack Cd correction coefficient
const ALPHA_CLAMP_RAD = 0.12;       // Max angle-of-attack for Cd correction [rad]
const DAMPING_COEFF = 0.1;          // Angular velocity damping coefficient
const OMEGA_CLAMP_RAD_S = 50.0;     // Max angular velocity [rad/s]

// Parachute
const PARACHUTE_INFLATION_DURATION = 0.3; // Parachute inflation time [s]
const TOUCHDOWN_ALTITUDE = 1.0;           // Consider landed when very close to ground [m]
const TOUCHDOWN_DESCENT_RATE = 1.0;       // Gentle descending speed threshold [m/s]

// 3. Types
interface AtmosphereState {
  rho: number;
  temp: number;
  pressure: number;
  soundSpeed: number;
}

interface ParachuteData {
  diameter: number; // [m]
  cd: number;
  found: boolean;
}

// 4. Functions
const getAtmosphere = (
  altitude: number,
  env: Environment,
  enableHumidity: boolean = true
): AtmosphereState => {
  const seaLevelTemp = (env.temperature || 15) + 273.15;
  const seaLevelPressure = (env.pressure || 1013) * 100;
  const humidity = Math.min(100, Math.max(0, env.humidity || 50));

  const h = Math.max(0, altitude);
  const temp = seaLevelTemp - LAPSE_RATE * h;

  if (temp <= 0) {
    return {
      rho: env.airDensity || 1.225,
      temp: seaLevelTemp,
      pressure: seaLevelPressure,
      soundSpeed: 340,
    };
  }

  const pressure = seaLevelPressure * Math.pow(
    1 - (LAPSE_RATE * h) / seaLevelTemp,
    G / (R_GAS * LAPSE_RATE)
  );

  let rho: number;
  if (enableHumidity) {
    const tempC = temp - 273.15;
    const e_sat = 611.2 * Math.exp((17.67 * tempC) / (tempC + 243.5));
    const e_actual = (humidity / 100) * e_sat;
    const virtualTemp = temp / (1 - 0.378 * e_actual / pressure);
    rho = pressure / (R_GAS * virtualTemp);
  } else {
    rho = pressure / (R_GAS * temp);
  }

  const soundSpeed = Math.sqrt(GAMMA * R_GAS * temp);
  return { rho, temp, pressure, soundSpeed };
};

/**
 * Mach-dependent drag coefficient with geometry-aware transonic peak.
 *
 * @param baseCd - Subsonic drag coefficient
 * @param mach - Current Mach number
 * @param finenessRatio - Rocket length/diameter ratio (optional, default 10)
 *   Slender rockets (high FR) have lower transonic drag rise;
 *   stubby rockets (low FR) have higher peak. Based on empirical data.
 */
const getDragCd = (baseCd: number, mach: number, finenessRatio: number = 10): number => {
  if (mach < 0.3) {
    return baseCd;
  } else if (mach < 0.8) {
    return baseCd / Math.sqrt(1 - mach * mach);
  } else if (mach < 1.2) {
    const pg08 = 1.0 / Math.sqrt(1 - 0.64);
    // Geometry-aware peak factor: slender rockets → lower peak, stubby → higher
    // peakFactor = 2.8 - 0.1 × FR, clamped to [1.2, 2.5]
    const peak = Math.max(1.2, Math.min(2.5, 2.8 - 0.1 * finenessRatio));
    const ss12 = peak * 1.1;  // supersonic at M=1.2 slightly above peak
    if (mach < 1.0) {
      const t = (mach - 0.8) / 0.2;
      const factor = pg08 + (peak - pg08) * t * t;
      return baseCd * factor;
    } else {
      const t = (mach - 1.0) / 0.2;
      const factor = peak + (ss12 - peak) * t;
      return baseCd * factor;
    }
  } else if (mach < 2.0) {
    const peak = Math.max(1.2, Math.min(2.5, 2.8 - 0.1 * finenessRatio));
    const ss12 = peak * 1.1;
    return baseCd * Math.max(1.0, ss12 - 0.25 * (mach - 1.2));
  } else {
    const peak = Math.max(1.2, Math.min(2.5, 2.8 - 0.1 * finenessRatio));
    const ss12 = peak * 1.1;
    return baseCd * Math.max(1.0, ss12 - 0.25 * (mach - 1.2));
  }
};

const getThrust = (
  time: number,
  motor: MotorData,
  tempC: number = 20,
  enableTempCorrection: boolean = true
): number => {
  if (time < 0 || time > motor.burnTime) return 0;
  let tempCorrection = 1.0;
  if (enableTempCorrection) {
    const tempDiff = tempC - 20;
    const tempCoeff = 0.004;
    tempCorrection = 1.0 + tempCoeff * tempDiff;
    tempCorrection = Math.max(0.8, Math.min(1.2, tempCorrection));
  }
  if (!motor.thrustCurve || motor.thrustCurve.length < 2) {
    return (motor.averageThrust || 0) * tempCorrection;
  }
  const curve = motor.thrustCurve;
  for (let i = 0; i < curve.length - 1; i++) {
    if (time >= curve[i].time && time <= curve[i + 1].time) {
      const dt = curve[i + 1].time - curve[i].time;
      if (dt === 0) return curve[i].thrust * tempCorrection;
      const slope = (curve[i + 1].thrust - curve[i].thrust) / dt;
      const baseThrust = curve[i].thrust + slope * (time - curve[i].time);
      return baseThrust * tempCorrection;
    }
  }
  return 0;
};

const getRemainingPropellant = (
  time: number,
  motor: MotorData
): number => {
  const propMass = motor.propellantMass || 0;
  if (time >= motor.burnTime || time < 0) return 0;
  const curve = motor.thrustCurve;
  if (!curve || curve.length < 2) {
    return propMass * (1 - time / motor.burnTime);
  }
  let cumulativeImpulse = 0;
  let totalImpulse = 0;
  for (let i = 1; i < curve.length; i++) {
    const dt = curve[i].time - curve[i - 1].time;
    const avgThrust = (curve[i].thrust + curve[i - 1].thrust) / 2;
    totalImpulse += avgThrust * dt;
    if (curve[i].time <= time) {
      cumulativeImpulse += avgThrust * dt;
    } else if (curve[i - 1].time < time) {
      const partialDt = time - curve[i - 1].time;
      cumulativeImpulse += avgThrust * partialDt;
    }
  }
  const burnFraction = totalImpulse > 0 ? cumulativeImpulse / totalImpulse : time / motor.burnTime;
  return propMass * (1 - burnFraction);
};

const getWindVector3D = (
  altitude: number,
  env: Environment,
  time: number = 0
): { x: number; y: number; z: number } => {
  const sample = sampleWindProfile(env, altitude, time);
  const fromRad = (sample.direction * Math.PI) / 180;
  return {
    x: -sample.speed * Math.sin(fromRad),
    y: -sample.speed * Math.cos(fromRad),
    z: 0,
  };
};

const findParachute = (components: RocketComponent[]): ParachuteData => {
  for (const comp of components) {
    if (comp.type === 'PARACHUTE') {
      const diameter = (comp as any).diameter || 0.5;
      const cd = (comp as any).cd || 1.5;
      physicsLog(LogLevel.INFO, `[PHYSICS] Found parachute: Diameter=${(diameter * 100).toFixed(1)}cm, Cd=${cd}`);
      return { diameter, cd, found: true };
    }
    if (comp.subComponents) {
      const result = findParachute(comp.subComponents);
      if (result.found) return result;
    }
  }
  physicsLog(LogLevel.WARN, `[PHYSICS] ⚠️ Parachute not found, using default: diameter=50cm, Cd=1.5`);
  return { diameter: 0.5, cd: 1.5, found: false };
};

const calculateRocketLength = (components: RocketComponent[]): number => {
  let totalLength = 0;
  for (const comp of components) {
    if (comp.type === 'BODYTUBE' || comp.type === 'NOSECONE' || comp.type === 'TRANSITION') {
      totalLength += (comp as any).length || 0;
    }
    if (comp.type === 'STAGE' && comp.subComponents) {
      totalLength += calculateRocketLength(comp.subComponents);
    }
  }
  return totalLength;
};

const calculateInertia = (
  mass: number,
  length: number,
  diameter: number
): { Ixx: number; Izz: number } => {
  const r = diameter / 2;
  const Ixx = Math.max(1e-6, mass * (3 * r * r + length * length) / 12);
  const Izz = Math.max(1e-6, mass * r * r / 2);
  return { Ixx, Izz };
};

const getAoACdCorrection = (
  vRocketMag: number,
  crosswindMag: number
): number => {
  if (vRocketMag < 0.1 || crosswindMag < 0.01) return 0;
  const alpha = Math.atan(crosswindMag / vRocketMag);
  const alphaClamped = Math.min(alpha, 0.12);
  const Cd_alpha = 1.5;
  return Cd_alpha * alphaClamped * alphaClamped;
};

// ============================================================================
// Type definitions
// ============================================================================

/** 3D vector */
type Vec3 = { x: number; y: number; z: number };

/** Rocket state (vector attitude, no Euler angles!) */
interface RocketState {
  // Translational motion (ENU frame)
  position: Vec3;      // Position [m]
  velocity: Vec3;      // Velocity [m/s]

  // Rotational motion (body frame)
  axis: Vec3;          // Rocket axial unit vector (points to nose)
  omega: Vec3;         // Angular velocity [rad/s], body frame

  // Mass properties
  mass: number;        // Current mass [kg]

  // Time
  time: number;        // Current time [s]
}

/** Launch parameters */
interface LaunchParams {
  railLength: number;      // Rail length [m]
  launchAngle: number;     // Launch angle [deg], from horizontal
}

/** Rocket configuration profile (internal physics representation) */
export interface PhysicsProfile {
  baseCd: number;
  refArea: number;
  maxDiameter: number;
  referenceLength: number;
  cg: number;
  cp: number;
  rocketGeometry?: RocketGeometryForCP;  // For Mach-dependent CP correction
  Ixx: number;
  Izz: number;
  dryMass: number;
  propellantMass: number;
  motorCasingMass?: number;
  motorBurnTime: number;
  motorDelayTime: number;
  thrustCurve: { time: number; thrust: number }[];
  averageThrust?: number;
  parachuteDiameter?: number;
  parachuteCd?: number;
  simulationSettings?: {
    kThrust?: number;
    kDrag?: number;
    parachuteCdCorrection?: number;
  };
}

/** Parachute state */
interface ParachuteState {
  deployed: boolean;
  fullyInflated: boolean;
  deployTime: number;
  currentArea: number;     // Current effective area [m²]
}

/** Simulation output data point */
interface SimulationDataPoint {
  time: number;
  position: Vec3;
  velocity: Vec3;
  acceleration: Vec3;
  altitude: number;
  speed: number;
  pitch: number;           // Pitch angle relative to horizontal [deg]
  mass: number;
  thrust: number;
  drag: number;
  mach: number;
  angleOfAttack: number;
  dynamicPressure: number;
  relativeAirspeed: number;
  windVelocity: Vec3;
  parachuteDeployed: boolean;
}

// ============================================================================
// Vector operations (core utilities)
// ============================================================================

const vec3 = {
  /** Create vector */
  create: (x: number, y: number, z: number): Vec3 => ({ x, y, z }),
  /** Zero vector */
  zero: (): Vec3 => ({ x: 0, y: 0, z: 0 }),
  /** Vector addition */
  add: (a: Vec3, b: Vec3): Vec3 => ({
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z
  }),
  /** Vector subtraction */
  sub: (a: Vec3, b: Vec3): Vec3 => ({
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z
  }),
  /** Scalar multiplication */
  scale: (v: Vec3, s: number): Vec3 => ({
    x: v.x * s,
    y: v.y * s,
    z: v.z * s
  }),
  /** Dot product */
  dot: (a: Vec3, b: Vec3): number =>
    a.x * b.x + a.y * b.y + a.z * b.z,
  /** Cross product (important: for torque calculation!) */
  cross: (a: Vec3, b: Vec3): Vec3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  }),
  /** Vector length */
  length: (v: Vec3): number =>
    Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z),
  /** Normalize (key: prevent numerical drift!) */
  normalize: (v: Vec3): Vec3 => {
    const len = vec3.length(v);
    if (len < 1e-10) {
      return { x: 0, y: 0, z: 1 };
    }
    return vec3.scale(v, 1 / len);
  },
  /** Clamp (prevent explosion) */
  clamp: (v: Vec3, maxLength: number): Vec3 => {
    const len = vec3.length(v);
    if (len > maxLength) {
      return vec3.scale(v, maxLength / len);
    }
    return v;
  }
};

// ============================================================================
// HELPER FUNCTIONS (Wrappers)
// ============================================================================

function calculateWindVector(altitude: number, env: Environment, time: number = 0): Vec3 {
  return getWindVector3D(altitude, env, time);
}

function calculateDragCd(baseCd: number, mach: number, altitude: number, finenessRatio: number = 10): number {
  return getDragCd(baseCd, mach, finenessRatio);
}

function calculateThrustWrapper(time: number, config: PhysicsProfile, envTempC: number = 20): number {
  // Use core thrust calculation
  const motor = {
    burnTime: config.motorBurnTime,
    thrustCurve: config.thrustCurve,
    propellantMass: config.propellantMass,
    totalMass: (config.motorCasingMass || 0) + config.propellantMass,
    delayTime: config.motorDelayTime
  };
  const rawThrust = getThrust(time, motor as any, envTempC);
  const kThrust = config.simulationSettings?.kThrust ?? 1.0;
  return rawThrust * kThrust;
}

// Renamed to calculateThrust (exported or used locally)
const calculateThrust = calculateThrustWrapper;


function calculateCurrentMass(time: number, config: PhysicsProfile): number {
  const motor = {
    burnTime: config.motorBurnTime,
    thrustCurve: config.thrustCurve,
    propellantMass: config.propellantMass,
    totalMass: (config.motorCasingMass || 0) + config.propellantMass,
  };
  const remainingPropellant = getRemainingPropellant(time, motor as any);
  return config.dryMass + remainingPropellant;
}

function calculateDrag(
  velocity: Vec3,
  windVelocity: Vec3,
  airDensity: number,
  cd: number,
  refArea: number
): Vec3 {
  const vRel = vec3.sub(velocity, windVelocity);
  const vRelMag = vec3.length(vRel);

  if (vRelMag < 0.01) {
    return vec3.zero();
  }

  const q = 0.5 * airDensity * vRelMag * vRelMag;
  const dragMag = q * cd * refArea;
  const vRelHat = vec3.normalize(vRel);
  return vec3.scale(vRelHat, -dragMag);
}

function calculateParachuteDrag(
  velocity: Vec3,
  windVelocity: Vec3,
  airDensity: number,
  parachute: ParachuteState,
  config: PhysicsProfile
): Vec3 {
  if (!parachute.deployed) {
    return vec3.zero();
  }

  const vRel = vec3.sub(velocity, windVelocity);
  const vRelMag = vec3.length(vRel);

  if (vRelMag < 0.01) {
    return vec3.zero();
  }

  const q = 0.5 * airDensity * vRelMag * vRelMag;
  // Use 0.65 correction from physicsCore/physics6dof logic if defined, or default logic
  // physicsCore doesn't have a parachute logic with correction, but we copied the logic from physics6dofStable
  const correctedCd = (config.parachuteCd || 1.5) * 0.65;

  const dragMag = q * correctedCd * parachute.currentArea;
  const vRelHat = vec3.normalize(vRel);
  return vec3.scale(vRelHat, -dragMag);
}

function calculateAeroTorque(
  state: RocketState,
  velocity: Vec3,
  windVelocity: Vec3,
  airDensity: number,
  config: PhysicsProfile,
  mach: number = 0
): Vec3 {
  const vRel = vec3.sub(velocity, windVelocity);
  const vRelMag = vec3.length(vRel);

  if (vRelMag < 0.01) {
    return vec3.zero();
  }

  const vRelHat = vec3.normalize(vRel);
  const cosAlpha = vec3.dot(state.axis, vRelHat);
  const alpha = Math.acos(Math.max(-1, Math.min(1, cosAlpha)));

  if (Math.abs(alpha) < 0.01) {
    return vec3.zero();
  }

  const q = 0.5 * airDensity * vRelMag * vRelMag;
  const cnAlpha = 2.0;
  // Use a clamped small-angle model for restoring torque. The linear
  // Barrowman-style normal-force derivative is only valid at small AoA;
  // using sin(alpha) up to ~90 deg can vastly over-predict torque in mild
  // crosswinds right after rail departure and unrealistically pitch the
  // rocket over.
  const alphaEffective = Math.min(alpha, ALPHA_CLAMP_RAD);
  const normalForceMag = q * cnAlpha * alphaEffective * config.refArea;

  const axisXvRel = vec3.cross(state.axis, vRel);
  // Restoring normal force must oppose the current angle of attack. Using
  // cross(axisXvRel, axis) flips the sign and turns the aerodynamic torque
  // into a divergence source in crosswinds, which can pitch the rocket flat
  // immediately after rail exit. Reverse the order so the force produces a
  // stabilizing moment that drives the nose back toward the relative wind.
  const normalForceDir = vec3.normalize(vec3.cross(state.axis, axisXvRel));
  const normalForce = vec3.scale(normalForceDir, normalForceMag);

  // Dynamic CP: adjust for Mach-dependent effects (transonic/supersonic)
  const cpDynamic = config.rocketGeometry ? getCPAtMach(config.cp, mach, config.rocketGeometry) : config.cp;
  const leverArm = cpDynamic - config.cg;
  const rVector = vec3.scale(state.axis, -leverArm);
  const torque = vec3.cross(rVector, normalForce);

  const dampingTorque = vec3.scale(state.omega, -DAMPING_COEFF * airDensity * config.refArea * config.referenceLength);

  return vec3.add(torque, dampingTorque);
}

function isOnRail(state: RocketState, railLength: number): boolean {
  const distance = vec3.length(state.position);
  return distance < railLength;
}

function applyRailConstraint(
  state: RocketState,
  launchAngleRad: number
): RocketState {
  const railDir = {
    x: Math.cos(launchAngleRad),
    y: 0,
    z: Math.sin(launchAngleRad)
  };
  state.axis = railDir;
  state.omega = vec3.zero();
  const vAlongRail = vec3.dot(state.velocity, railDir);
  if (vAlongRail > 0) {
    state.velocity = vec3.scale(railDir, vAlongRail);
  } else {
    state.velocity = vec3.zero();
  }
  return state;
}

function updateParachute(
  parachute: ParachuteState,
  time: number,
  altitude: number,
  velocity: Vec3,
  motorBurnTime: number,
  config: PhysicsProfile
): ParachuteState {
  const newState = { ...parachute };
  const hasLaunched = time > 0.1;
  const safeAltitude = altitude > 5.0;
  const delayTime = config.motorDelayTime || 0;
  const ejectionTime = motorBurnTime + delayTime;

  let shouldDeploy = false;
  let deployReason = '';

  if (delayTime > 0) {
    if (hasLaunched && time >= ejectionTime && safeAltitude) {
      shouldDeploy = true;
      deployReason = `motor delay (${delayTime.toFixed(1)}s after burn, ejection at t=${ejectionTime.toFixed(2)}s)`;
    }
  } else {
    const engineBurnedOut = time > motorBurnTime;
    const isDescending = velocity.z < -1.0;
    if (hasLaunched && engineBurnedOut && isDescending && safeAltitude) {
      shouldDeploy = true;
      deployReason = 'apogee detection (vy < -1.0 m/s, no delay time specified)';
    }
  }

  if (shouldDeploy && !newState.deployed) {
    newState.deployed = true;
    newState.deployTime = time;
    newState.fullyInflated = false;

    const parachuteArea = Math.PI * Math.pow(config.parachuteDiameter! / 2, 2);
    const correctedCd = (config.parachuteCd || 1.5) * 0.65;
    const descentMass = config.dryMass;
    const estTerminalV = Math.sqrt((2 * descentMass * G) / (1.225 * correctedCd * parachuteArea));
    const estDescentTime = altitude / estTerminalV;

    console.log(`[6DOF Stable] 🪂 Parachute deployed: t=${time.toFixed(2)}s, h=${altitude.toFixed(1)}m, vy=${velocity.z.toFixed(1)}m/s`);
    console.log(`[6DOF Stable]    Reason: ${deployReason}`);
    console.log(`[6DOF Stable]    Parachute: diameter=${(config.parachuteDiameter! * 100).toFixed(1)}cm, Cd=${config.parachuteCd?.toFixed(2)} (corrected: ${correctedCd.toFixed(2)})`);
    console.log(`[6DOF Stable]    Est. terminal velocity: ${estTerminalV.toFixed(2)} m/s, est. descent time: ${estDescentTime.toFixed(1)}s`);
  }

  if (newState.deployed && !newState.fullyInflated) {
    const elapsed = time - newState.deployTime;
    if (elapsed >= PARACHUTE_INFLATION_DURATION) {
      newState.fullyInflated = true;
      newState.currentArea = Math.PI * Math.pow(config.parachuteDiameter! / 2, 2);
    } else {
      const progress = elapsed / PARACHUTE_INFLATION_DURATION;
      newState.currentArea = Math.PI * Math.pow(config.parachuteDiameter! / 2, 2) * progress;
    }
  }
  return newState;
}

function computeDerivatives(
  state: RocketState,
  config: PhysicsProfile,
  env: Environment,
  launchParams: LaunchParams,
  parachute: ParachuteState
): {
  dPosition: Vec3;
  dVelocity: Vec3;
  dAxis: Vec3;
  dOmega: Vec3;
} {
  const altitude = state.position.z;
  const atm = getAtmosphere(altitude, env);
  const windVel = calculateWindVector(altitude, env, state.time);
  const currentMass = calculateCurrentMass(state.time, config);
  const { Ixx, Izz } = calculateInertia(currentMass, config.referenceLength, config.maxDiameter);
  const vRel = vec3.sub(state.velocity, windVel);
  const vRelMag = vec3.length(vRel);
  const mach = vRelMag / atm.soundSpeed;
  const fr = config.rocketGeometry?.finenessRatio ?? 10;
  let cd = calculateDragCd(config.baseCd, mach, altitude, fr);

  if (vRelMag > 1.0 && env.windSpeed > 0.5) {
    const vRelHat = vec3.normalize(vRel);
    const cosAlpha = vec3.dot(state.axis, vRelHat);
    const alpha = Math.acos(Math.max(-1, Math.min(1, cosAlpha)));
    const alphaClamped = Math.min(alpha, ALPHA_CLAMP_RAD);
    const Cd_AoA = CD_ALPHA_COEFF * alphaClamped * alphaClamped;
    cd += Cd_AoA;
  }

  const kDrag = config.simulationSettings?.kDrag ?? 1.0;
  cd *= kDrag;

  const thrustMag = calculateThrust(state.time, config, env.temperature);
  const thrustForce = vec3.scale(state.axis, thrustMag);

  let dragForce: Vec3;
  if (parachute.fullyInflated) {
    dragForce = vec3.zero();
  } else {
    dragForce = calculateDrag(state.velocity, windVel, atm.rho, cd, config.refArea);
  }

  const parachuteDragForce = calculateParachuteDrag(
    state.velocity,
    windVel,
    atm.rho,
    parachute,
    config
  );

  const gravityForce = vec3.create(0, 0, -currentMass * G);

  let totalForce = vec3.add(thrustForce, dragForce);
  totalForce = vec3.add(totalForce, parachuteDragForce);
  totalForce = vec3.add(totalForce, gravityForce);

  const acceleration = vec3.scale(totalForce, 1 / currentMass);
  let torque = calculateAeroTorque(state, state.velocity, windVel, atm.rho, config, mach);

  if (parachute.fullyInflated) {
    torque = vec3.scale(torque, 0.01);
  }

  const dAxis = vec3.cross(state.omega, state.axis);
  const dOmega = {
    x: (torque.x - (Izz - Ixx) * state.omega.y * state.omega.z) / Ixx,
    y: (torque.y - (Ixx - Izz) * state.omega.z * state.omega.x) / Ixx,
    z: torque.z / Izz
  };

  return { dPosition: state.velocity, dVelocity: acceleration, dAxis, dOmega };
}

function rk4Step(
  state: RocketState,
  config: PhysicsProfile,
  env: Environment,
  launchParams: LaunchParams,
  parachute: ParachuteState,
  dt: number
): RocketState {
  const k1 = computeDerivatives(state, config, env, launchParams, parachute);

  const state2 = {
    ...state,
    time: state.time + dt / 2,
    position: vec3.add(state.position, vec3.scale(k1.dPosition, dt / 2)),
    velocity: vec3.add(state.velocity, vec3.scale(k1.dVelocity, dt / 2)),
    axis: vec3.normalize(vec3.add(state.axis, vec3.scale(k1.dAxis, dt / 2))),
    omega: vec3.add(state.omega, vec3.scale(k1.dOmega, dt / 2))
  };
  const k2 = computeDerivatives(state2, config, env, launchParams, parachute);

  const state3 = {
    ...state,
    time: state.time + dt / 2,
    position: vec3.add(state.position, vec3.scale(k2.dPosition, dt / 2)),
    velocity: vec3.add(state.velocity, vec3.scale(k2.dVelocity, dt / 2)),
    axis: vec3.normalize(vec3.add(state.axis, vec3.scale(k2.dAxis, dt / 2))),
    omega: vec3.add(state.omega, vec3.scale(k2.dOmega, dt / 2))
  };
  const k3 = computeDerivatives(state3, config, env, launchParams, parachute);

  const state4 = {
    ...state,
    time: state.time + dt,
    position: vec3.add(state.position, vec3.scale(k3.dPosition, dt)),
    velocity: vec3.add(state.velocity, vec3.scale(k3.dVelocity, dt)),
    axis: vec3.normalize(vec3.add(state.axis, vec3.scale(k3.dAxis, dt))),
    omega: vec3.add(state.omega, vec3.scale(k3.dOmega, dt))
  };
  const k4 = computeDerivatives(state4, config, env, launchParams, parachute);

  const newPosition = vec3.add(state.position, vec3.scale(vec3.add(vec3.add(k1.dPosition, vec3.scale(k2.dPosition, 2)), vec3.add(vec3.scale(k3.dPosition, 2), k4.dPosition)), dt / 6));
  const newVelocity = vec3.add(state.velocity, vec3.scale(vec3.add(vec3.add(k1.dVelocity, vec3.scale(k2.dVelocity, 2)), vec3.add(vec3.scale(k3.dVelocity, 2), k4.dVelocity)), dt / 6));
  const newAxis = vec3.normalize(vec3.add(state.axis, vec3.scale(vec3.add(vec3.add(k1.dAxis, vec3.scale(k2.dAxis, 2)), vec3.add(vec3.scale(k3.dAxis, 2), k4.dAxis)), dt / 6)));
  const newOmega = vec3.add(state.omega, vec3.scale(vec3.add(vec3.add(k1.dOmega, vec3.scale(k2.dOmega, 2)), vec3.add(vec3.scale(k3.dOmega, 2), k4.dOmega)), dt / 6));

  return {
    position: newPosition,
    velocity: newVelocity,
    axis: newAxis,
    omega: vec3.clamp(newOmega, OMEGA_CLAMP_RAD_S),
    mass: calculateCurrentMass(state.time + dt, config),
    time: state.time + dt
  };
}

export function simulate6DOF(
  config: PhysicsProfile,
  env: Environment,
  launchParams: LaunchParams
): SimulationDataPoint[] {
  const launchAngleRad = (launchParams.launchAngle * Math.PI) / 180;
  let state: RocketState = {
    position: vec3.zero(),
    velocity: vec3.zero(),
    axis: vec3.create(Math.cos(launchAngleRad), 0, Math.sin(launchAngleRad)),
    omega: vec3.zero(),
    mass: calculateCurrentMass(0, config),
    time: 0
  };

  let parachute: ParachuteState = {
    deployed: false,
    fullyInflated: false,
    deployTime: 0,
    currentArea: 0
  };

  const data: SimulationDataPoint[] = [];
  let lastLogTime = -1;

  while (state.time < MAX_SIMULATION_TIME) {
    const altitude = state.position.z;
    const speed = vec3.length(state.velocity);
    const atm = getAtmosphere(altitude, env);
    const windVel = calculateWindVector(altitude, env, state.time);
    const vRel = vec3.sub(state.velocity, windVel);
    const vRelMag = vec3.length(vRel);
    const mach = vRelMag / atm.soundSpeed;
    const pitch = Math.asin(Math.max(-1, Math.min(1, state.axis.z))) * 180 / Math.PI;
    const vRelHat = vRelMag > 1e-6 ? vec3.normalize(vRel) : state.axis;
    const cosAlpha = vec3.dot(state.axis, vRelHat);
    const alphaRad = Math.acos(Math.max(-1, Math.min(1, cosAlpha)));
    const dynamicPressure = 0.5 * atm.rho * vRelMag * vRelMag;

    const thrust = calculateThrust(state.time, config, env.temperature);
    let cd = calculateDragCd(config.baseCd, mach, altitude, config.rocketGeometry?.finenessRatio ?? 10);

    if (vRelMag > 1.0 && env.windSpeed > 0.5) {
      const alphaClamped = Math.min(alphaRad, ALPHA_CLAMP_RAD);
      const Cd_AoA = CD_ALPHA_COEFF * alphaClamped * alphaClamped;
      cd += Cd_AoA;
    }

    const kDrag = config.simulationSettings?.kDrag ?? 1.0;
    cd *= kDrag;

    let totalDragMag: number;
    if (parachute.fullyInflated) {
      const parachuteDrag = calculateParachuteDrag(state.velocity, windVel, atm.rho, parachute, config);
      totalDragMag = vec3.length(parachuteDrag);
    } else {
      const dragForce = calculateDrag(state.velocity, windVel, atm.rho, cd, config.refArea);
      totalDragMag = vec3.length(dragForce);
    }

    const thrustVec = vec3.scale(state.axis, thrust);
    const gravityVec = vec3.create(0, 0, -G * state.mass);
    const netForce = vec3.add(thrustVec, gravityVec);
    const accelMag = vec3.length(netForce) / Math.max(state.mass, 0.001);

    data.push({
      time: state.time,
      position: { ...state.position },
      velocity: { ...state.velocity },
      acceleration: vec3.create(0, 0, accelMag),
      altitude,
      speed,
      pitch,
      mass: state.mass,
      thrust,
      drag: totalDragMag,
      mach,
      angleOfAttack: alphaRad * 180 / Math.PI,
      dynamicPressure,
      relativeAirspeed: vRelMag,
      windVelocity: { ...windVel },
      parachuteDeployed: parachute.deployed
    });

    if (Math.floor(state.time / 0.5) > lastLogTime) {
      lastLogTime = Math.floor(state.time / 0.5);
    }

    const nearGroundTouchdown =
      altitude <= TOUCHDOWN_ALTITUDE &&
      state.time > 1.0 &&
      state.velocity.z <= 0 &&
      Math.abs(state.velocity.z) <= TOUCHDOWN_DESCENT_RATE;

    if (altitude < GROUND_TOLERANCE && state.time > 1.0) {
      break;
    }

    if (nearGroundTouchdown) {
      data[data.length - 1].altitude = 0;
      data[data.length - 1].position.z = 0;
      break;
    }

    parachute = updateParachute(parachute, state.time, altitude, state.velocity, config.motorBurnTime, config);

    const onRail = isOnRail(state, launchParams.railLength);
    if (onRail) {
      state = applyRailConstraint(state, launchAngleRad);
      const derivatives = computeDerivatives(state, config, env, launchParams, parachute);
      state.position = vec3.add(state.position, vec3.scale(derivatives.dPosition, DT));
      state.velocity = vec3.add(state.velocity, vec3.scale(derivatives.dVelocity, DT));
      state.time += DT;
      state.mass = calculateCurrentMass(state.time, config);
    } else {
      state = rk4Step(state, config, env, launchParams, parachute, DT);
    }
  }

  return data;
}

function createPhysicsProfile(rocket: RocketConfig): PhysicsProfile {
  const parsedMass = rocket.simulationSettings?.mass;
  const overrideMass = rocket.manualOverride?.mass;
  const calculatedMass = calculateDryMass(rocket.stages);
  const motorCasingMassEst = Math.max(0, (rocket.motor?.totalMass ?? 0) - (rocket.motor?.propellantMass ?? 0));
  const propellantMass = rocket.motor?.propellantMass ?? 0.024;
  let dryMass: number;
  if (overrideMass) {
    dryMass = overrideMass;
  } else if (parsedMass) {
    // OpenRocket flightdata "Mass" is launch mass at t=0, which already includes propellant.
    // Our internal dryMass convention includes structure + motor casing, but excludes propellant
    // because propellant burn-down is handled dynamically in calculateCurrentMass().
    dryMass = Math.max(parsedMass - propellantMass, 0);
  } else {
    dryMass = calculatedMass + motorCasingMassEst;
  }

  const maxDia = rocket.manualOverride?.diameter || findMaxDiameter(rocket.stages) || 0.05;
  const refArea = calculateReferenceArea(rocket.stages) || Math.PI * Math.pow(maxDia / 2, 2);
  const referenceLength = rocket.simulationSettings?.referenceLength || calculateRocketLength(rocket.stages) || maxDia * 10;
  const stabilityReferenceLength = resolveStabilityReferenceLength(rocket.stages, rocket.simulationSettings?.referenceLength);
  const parsedCG = rocket.simulationSettings?.cg;
  const overrideCG = rocket.manualOverride?.cg;
  const calculatedCG = calculateCG(rocket.stages);
  const parsedCP = rocket.simulationSettings?.cp;
  const calculatedCP = calculateCP(rocket.stages);

  let cg = overrideCG || parsedCG || calculatedCG;
  let cp = parsedCP || calculatedCP;

  const hasParsedPair = overrideCG === undefined && parsedCG !== undefined && parsedCP !== undefined;
  const computedPairLooksValid = Number.isFinite(calculatedCG) && Number.isFinite(calculatedCP) && calculatedCP > calculatedCG;
  const parsedPairLooksValid = Number.isFinite(cg) && Number.isFinite(cp) && cp > cg;
  const cgDelta = Math.abs(cg - calculatedCG);
  const cpDelta = Math.abs(cp - calculatedCP);
  const maxAllowedDelta = Math.max(0.10, stabilityReferenceLength * 0.35);

  if (hasParsedPair && (!parsedPairLooksValid || ((cgDelta > maxAllowedDelta || cpDelta > maxAllowedDelta) && computedPairLooksValid))) {
    physicsLog(
      LogLevel.WARN,
      `[PHYSICS] Falling back to computed CG/CP. Parsed pair looked inconsistent: parsed CG=${cg.toFixed(3)}m, CP=${cp.toFixed(3)}m; computed CG=${calculatedCG.toFixed(3)}m, CP=${calculatedCP.toFixed(3)}m`
    );
    cg = calculatedCG;
    cp = calculatedCP;
  }

  const totalMass = dryMass + propellantMass;
  const { Ixx, Izz } = calculateInertia(totalMass, referenceLength, maxDia);
  const baseCd = rocket.manualOverride?.cdOverride ?? rocket.cdOverride ?? 0.45;
  const motorTotalMass = rocket.motor?.totalMass ?? 0;
  const motorCasingMass = Math.max(0, motorTotalMass - propellantMass);
  const motorBurnTime = rocket.motor?.burnTime ?? 1.5;
  const motorDelayTime = rocket.motor?.delayTime ?? 0;
  const thrustCurve = rocket.motor?.thrustCurve || [];
  const parachute = findParachute(rocket.stages);

  const rocketGeometry = extractCPGeometry(rocket.stages);

  return {
    baseCd,
    refArea,
    maxDiameter: maxDia,
    referenceLength,
    cg,
    cp,
    rocketGeometry,
    Ixx,
    Izz,
    dryMass,
    propellantMass,
    motorCasingMass,
    motorBurnTime,
    motorDelayTime,
    thrustCurve,
    parachuteDiameter: parachute.diameter,
    parachuteCd: parachute.cd,
    simulationSettings: {
      kThrust: rocket.simulationSettings?.kThrust,
      kDrag: rocket.simulationSettings?.kDrag
    }
  };
}

function convertEnvironment(env: Environment): Environment {
  return syncEnvironmentWindScalars({
    windSpeed: env.windSpeed ?? 0,
    windDirection: env.windDirection ?? 0,
    humidity: env.humidity ?? 50,
    temperature: env.temperature ?? 20,
    pressure: env.pressure ?? 1013.25,
    airDensity: env.airDensity ?? 1.225,
    windProfile: env.windProfile,
  });
}

function convertToSimulationResult(data: SimulationDataPoint[], config: PhysicsProfile, env: Environment): SimulationResult {
  if (data.length === 0) {
    return {
      apogee: 0,
      maxVelocity: 0,
      flightTime: 0,
      data: [],
      calculatedMass: config.dryMass + config.propellantMass,
      calculatedArea: config.refArea
    };
  }

  const apogee = Math.max(...data.map(p => p.altitude));
  const maxVelocity = Math.max(...data.map(p => p.speed));
  const flightTime = data[data.length - 1]?.time || 0;

  const simulationPoints: SimulationPoint[] = data.map(p => {
    const horizontalVel = Math.sqrt(p.velocity.x * p.velocity.x + p.velocity.y * p.velocity.y);
    const horizontalDir = Math.sign(p.velocity.x || p.velocity.y || 1);
    const atm = getAtmosphere(p.altitude, env);
    const pointCd = calculateDragCd(config.baseCd, p.mach, p.altitude, config.rocketGeometry?.finenessRatio ?? 10);

    return {
      time: p.time,
      altitude: p.altitude,
      range: Math.sqrt(p.position.x * p.position.x + p.position.y * p.position.y),
      velocity: p.speed,
      velocityX: horizontalVel * horizontalDir,
      velocityY: p.velocity.z,
      acceleration: Math.sqrt(p.acceleration.x * p.acceleration.x + p.acceleration.y * p.acceleration.y + p.acceleration.z * p.acceleration.z),
      thrust: p.thrust,
      drag: p.drag,
      mass: p.mass,
      airDensity: atm.rho,
      cd: pointCd,
      relativeAirspeed: p.relativeAirspeed,
      dynamicPressure: p.dynamicPressure,
      windSpeedAtAltitude: vec3.length(p.windVelocity),
      windVelocityX: p.windVelocity.x,
      windVelocityY: p.windVelocity.y,
      windDirectionAtAltitude: ((Math.atan2(-p.windVelocity.x, -p.windVelocity.y) * 180) / Math.PI + 360) % 360,
      parachuteDeployed: p.parachuteDeployed,
      pitch: p.pitch,
      mach: p.mach,
      angleOfAttack: p.angleOfAttack,
      dragCoefficient: pointCd
    };
  });

  return {
    apogee,
    maxVelocity,
    flightTime,
    data: simulationPoints,
    calculatedMass: config.dryMass + config.propellantMass,
    calculatedArea: config.refArea
  };
}

export const runSimulation = async (
  rocket: RocketConfig,
  env: Environment,
  launchAngleDeg: number = 90,
  railLength: number = 1.0
): Promise<SimulationResult> => {
  const stableConfig = createPhysicsProfile(rocket);
  const stableEnv = convertEnvironment(env);
  const launchParams: LaunchParams = { railLength, launchAngle: launchAngleDeg };
  const data = simulate6DOF(stableConfig, stableEnv, launchParams);
  return convertToSimulationResult(data, stableConfig, stableEnv);
};

export type {
  Vec3,
  RocketState,
  RocketConfig,
  Environment,
  LaunchParams,
  ParachuteState,
  SimulationDataPoint
};
