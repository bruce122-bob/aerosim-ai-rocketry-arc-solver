import { RocketConfig, Environment, SimulationResult, SimulationPoint, MotorData, RocketComponent } from "../types";
import { calculateStability } from "./stability";
import { calculateDryMass, calculateReferenceArea } from "./rocketUtils";

// ============================================================================
// Internal Physics Helpers (Restored from PhysicsCore)
// ============================================================================

const G = 9.80665;          // Standard gravity [m/s²]
const R_GAS = 287.05;      // Specific gas constant for dry air [J/(kg·K)]
const GAMMA = 1.4;         // Adiabatic index for air
const LAPSE_RATE = 0.0065; // ISA temperature lapse rate [K/m]

// Simulation time step and limits
const DT = 0.02;                    // Integration time step [s] (50 Hz)
const MAX_TIME = 300;               // Maximum simulation duration [s]
const GROUND_TOLERANCE = -0.05;     // Landing threshold [m]

// Wind shear (WMO standard: reference height 10m, Hellmann exponent 0.14 for open terrain)
const WIND_SHEAR_REF_HEIGHT = 10.0; // Reference height [m]
const WIND_SHEAR_EXPONENT = 0.14;   // Hellmann exponent (open terrain)

interface AtmosphereState {
  rho: number;         // Density [kg/m³]
  temp: number;        // Temperature [K]
  pressure: number;    // Pressure [Pa]
  soundSpeed: number;  // Speed of sound [m/s]
}

const getAtmosphere = (
  altitude: number,
  env: Environment,
  enableHumidity: boolean = true
): AtmosphereState => {
  // Use user-defined base conditions (from UI)
  const seaLevelTemp = (env.temperature || 15) + 273.15; // Celsius → Kelvin
  const seaLevelPressure = (env.pressure || 1013) * 100; // hPa → Pa
  const humidity = Math.min(100, Math.max(0, env.humidity || 50)); // 0-100%

  // ISA lapse rate model starting from user's sea level conditions
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
    const e_sat = 611.2 * Math.exp((17.67 * tempC) / (tempC + 243.5)); // Pa
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
 * @param finenessRatio - Rocket length/diameter ratio (default 10)
 */
const getDragCd = (baseCd: number, mach: number, finenessRatio: number = 10): number => {
  if (mach < 0.3) {
    return baseCd;
  } else if (mach < 0.8) {
    return baseCd / Math.sqrt(1 - mach * mach);
  } else if (mach < 1.2) {
    const pg08 = 1.0 / Math.sqrt(1 - 0.64);
    // Geometry-aware peak: slender rockets → lower peak, stubby → higher
    const peak = Math.max(1.2, Math.min(2.5, 2.8 - 0.1 * finenessRatio));
    const ss12 = peak * 1.1;
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

  const burnFraction = totalImpulse > 0
    ? cumulativeImpulse / totalImpulse
    : time / motor.burnTime;

  return propMass * (1 - burnFraction);
};

const getWindVector2D = (
  altitude: number,
  env: Environment,
  enableWindShear: boolean = true
): { windVx: number; windVy: number } => {
  let windSpeed = env.windSpeed;
  if (enableWindShear && altitude > WIND_SHEAR_REF_HEIGHT) {
    windSpeed = env.windSpeed * Math.pow(altitude / WIND_SHEAR_REF_HEIGHT, WIND_SHEAR_EXPONENT);
  }
  const windAngleMathDeg = 90 - env.windDirection;
  const windAngleRad = (windAngleMathDeg * Math.PI) / 180;
  const windVx = -windSpeed * Math.cos(windAngleRad);
  const windVy = 0;
  return { windVx, windVy };
};

interface ParachuteData {
  diameter: number;
  cd: number;
  found: boolean;
}

const findParachute = (components: RocketComponent[]): ParachuteData => {
  for (const comp of components) {
    if (comp.type === 'PARACHUTE') {
      const diameter = (comp as any).diameter || 0.5;
      const cd = (comp as any).cd || 1.5;
      return { diameter, cd, found: true };
    }
    if (comp.subComponents) {
      const result = findParachute(comp.subComponents);
      if (result.found) return result;
    }
  }
  return { diameter: 0.5, cd: 1.5, found: false };
};

// ============================================================================
// Main Physics Engine (2D)
// ============================================================================

// --- State Vector: [x, y, vx, vy] ---
// x: downrange distance (m)
// y: altitude (m)
// vx: horizontal velocity (m/s)
// vy: vertical velocity (m/s)
type StateVector = [number, number, number, number];

interface DerivativeResult {
  dydt: StateVector;
  accel: number;
  dragForce: number;
  thrustForce: number;
  atmos: AtmosphereState;
  cd: number;
}

// --- Equations of Motion (2D Ballistic Flight) ---
const PARACHUTE_INFLATION_DURATION = 0.3; // P-3: 0.3s inflation time

const derivatives = (
  time: number,
  state: StateVector,
  rocket: RocketConfig,
  env: Environment,
  currentMass: number,
  refArea: number,
  launchAngleRad: number,
  rodLength: number,
  isOnRod: boolean,
  parachuteDeployed: boolean,
  parachuteData: ParachuteData,
  parachuteDeployTime: number = 0
): DerivativeResult => {
  const [x, y, vx, vy] = state;

  // 1. Atmosphere at current altitude
  const atmos = getAtmosphere(y, env);

  // 2. Wind (meteorological convention)
  const wind = getWindVector2D(y, env);
  const windVx = wind.windVx;
  const windVy = wind.windVy;

  // 3. Relative velocity (rocket velocity - wind velocity)
  const vRelX = vx - windVx;
  const vRelY = vy - windVy;
  const vRelMag = Math.sqrt(vRelX * vRelX + vRelY * vRelY);

  // 4. Drag Force
  const mach = vRelMag / atmos.soundSpeed;
  let dragArea = refArea;
  let Cd = getDragCd(rocket.cdOverride, mach);

  // P-2 & P-3: Parachute drag with Cd correction and gradual opening
  let parachuteEffectiveness = 0;
  if (parachuteDeployed && parachuteData.found) {
    dragArea = Math.PI * Math.pow(parachuteData.diameter / 2, 2);
    // P-2: Apply 0.65 correction factor matching other engines
    Cd = parachuteData.cd * 0.65;
    // P-3: Gradual opening over PARACHUTE_INFLATION_DURATION
    if (parachuteDeployTime > 0 && time < parachuteDeployTime + PARACHUTE_INFLATION_DURATION) {
      parachuteEffectiveness = Math.max(0, Math.min(1, (time - parachuteDeployTime) / PARACHUTE_INFLATION_DURATION));
    } else {
      parachuteEffectiveness = 1.0;
    }
  }

  // Apply parachute effectiveness for gradual inflation
  const effectiveDragArea = parachuteEffectiveness > 0
    ? dragArea * parachuteEffectiveness
    : dragArea;
  const dragMag = 0.5 * atmos.rho * (vRelX * vRelX + vRelY * vRelY) * Cd * effectiveDragArea;

  // Drag direction is opposite to relative velocity
  let dragX = 0;
  let dragY = 0;
  if (vRelMag > 0.01) {
    dragX = -dragMag * (vRelX / vRelMag);
    dragY = -dragMag * (vRelY / vRelMag);
  }

  // 5. Thrust Force (with temperature correction)
  const tempC = atmos.temp - 273.15;
  const thrustMag = getThrust(time, rocket.motor, tempC);
  let thrustX = 0;
  let thrustY = 0;

  if (isOnRod) {
    // On launch rod: thrust along rod angle
    thrustX = thrustMag * Math.cos(launchAngleRad);
    thrustY = thrustMag * Math.sin(launchAngleRad);
  } else if (!parachuteDeployed && thrustMag > 0) {
    // Free flight with thrust: thrust along velocity vector (gravity turn)
    if (vRelMag > 0.1) {
      thrustX = thrustMag * (vRelX / vRelMag);
      thrustY = thrustMag * (vRelY / vRelMag);
    } else {
      // Very low velocity: thrust vertical
      thrustX = 0;
      thrustY = thrustMag;
    }
  }
  // If parachute deployed: no thrust (motor burned out)

  // 6. Gravity
  const gravityY = -currentMass * G;

  // 7. Total Forces
  const Fx = dragX + thrustX;
  const Fy = dragY + thrustY + gravityY;

  // 8. Accelerations
  const ax = Fx / currentMass;
  const ay = Fy / currentMass;

  const accelMag = Math.sqrt(ax * ax + ay * ay);

  return {
    dydt: [vx, vy, ax, ay],
    accel: accelMag,
    dragForce: dragMag,
    thrustForce: thrustMag,
    atmos,
    cd: Cd
  };
};

// --- Main Simulation Function ---
export const runSimulation = (
  rocket: RocketConfig,
  env: Environment,
  launchAngleDeg: number = 90,
  rodLength: number = 1.0
): SimulationResult => {
  let time = 0;
  let state: StateVector = [0, 0, 0, 0]; // [x, y, vx, vy]
  const data: SimulationPoint[] = [];

  // Rocket properties
  const dryMass = calculateDryMass(rocket.stages);
  const refArea = calculateReferenceArea(rocket.stages);
  const propellantMass = rocket.motor.propellantMass;
  const totalMotorMass = rocket.motor.totalMass;
  const parachuteData = findParachute(rocket.stages);

  const launchAngleRad = (launchAngleDeg * Math.PI) / 180;

  // Tracking variables
  let apogee = 0;
  let maxVelocity = 0;
  let hasLaunched = false;
  let parachuteDeployed = false;
  let parachuteDeployTimeTracker = 0;
  let apogeeTime = 0;

  // Main simulation loop
  while (time < MAX_TIME) {
    // Propellant consumption using thrust-integral model
    const remainingProp = getRemainingPropellant(time, rocket.motor);
    let currentMass = dryMass + (totalMotorMass - propellantMass) + remainingProp;
    currentMass = Math.max(currentMass, dryMass);

    // 2. Determine flight phase
    const distanceFromPad = Math.sqrt(state[0] * state[0] + state[1] * state[1]);
    const isOnRod = distanceFromPad < rodLength;

    // P-1: Parachute deployment logic with motor delay time support
    const delayTime = rocket.motor?.delayTime ?? 0;
    if (!parachuteDeployed && hasLaunched) {
      if (delayTime > 0) {
        // Timer-based deployment: deploy at burnTime + delayTime
        const ejectionTime = rocket.motor.burnTime + delayTime;
        if (time >= ejectionTime && state[1] > 5.0) {
          parachuteDeployed = true;
          if (parachuteDeployTimeTracker === 0) parachuteDeployTimeTracker = time;
        }
      } else {
        // Apogee detection: deploy when descending, motor burned out, altitude > 5m
        if (state[3] < -1.0 && time > rocket.motor.burnTime && state[1] > 5.0) {
          parachuteDeployed = true;
          if (parachuteDeployTimeTracker === 0) parachuteDeployTimeTracker = time;
        }
      }
    }

    // 4. RK4 Integration (pass parachuteDeployTimeTracker for gradual inflation)
    const k1 = derivatives(time, state, rocket, env, currentMass, refArea, launchAngleRad, rodLength, isOnRod, parachuteDeployed, parachuteData, parachuteDeployTimeTracker);

    const state_k2: StateVector = [
      state[0] + k1.dydt[0] * DT / 2,
      state[1] + k1.dydt[1] * DT / 2,
      state[2] + k1.dydt[2] * DT / 2,
      state[3] + k1.dydt[3] * DT / 2
    ];
    const k2 = derivatives(time + DT / 2, state_k2, rocket, env, currentMass, refArea, launchAngleRad, rodLength, isOnRod, parachuteDeployed, parachuteData, parachuteDeployTimeTracker);

    const state_k3: StateVector = [
      state[0] + k2.dydt[0] * DT / 2,
      state[1] + k2.dydt[1] * DT / 2,
      state[2] + k2.dydt[2] * DT / 2,
      state[3] + k2.dydt[3] * DT / 2
    ];
    const k3 = derivatives(time + DT / 2, state_k3, rocket, env, currentMass, refArea, launchAngleRad, rodLength, isOnRod, parachuteDeployed, parachuteData, parachuteDeployTimeTracker);

    const state_k4: StateVector = [
      state[0] + k3.dydt[0] * DT,
      state[1] + k3.dydt[1] * DT,
      state[2] + k3.dydt[2] * DT,
      state[3] + k3.dydt[3] * DT
    ];
    const k4 = derivatives(time + DT, state_k4, rocket, env, currentMass, refArea, launchAngleRad, rodLength, isOnRod, parachuteDeployed, parachuteData, parachuteDeployTimeTracker);

    // Update state using RK4
    const newState: StateVector = [
      state[0] + (DT / 6) * (k1.dydt[0] + 2 * k2.dydt[0] + 2 * k3.dydt[0] + k4.dydt[0]),
      state[1] + (DT / 6) * (k1.dydt[1] + 2 * k2.dydt[1] + 2 * k3.dydt[1] + k4.dydt[1]),
      state[2] + (DT / 6) * (k1.dydt[2] + 2 * k2.dydt[2] + 2 * k3.dydt[2] + k4.dydt[2]),
      state[3] + (DT / 6) * (k1.dydt[3] + 2 * k2.dydt[3] + 2 * k3.dydt[3] + k4.dydt[3])
    ];

    // Calculate derived metrics
    const velocityMag = Math.sqrt(newState[2] * newState[2] + newState[3] * newState[3]);

    // Record data point
    data.push({
      time: parseFloat(time.toFixed(3)),
      altitude: Math.max(0, newState[1]),
      range: newState[0],
      velocity: velocityMag,
      velocityX: newState[2],
      velocityY: newState[3],
      acceleration: k1.accel,
      thrust: k1.thrustForce,
      drag: k1.dragForce,
      mass: currentMass,
      airDensity: k1.atmos.rho,
      cd: k1.cd
    });

    // Track apogee
    if (newState[1] > apogee) {
      apogee = newState[1];
      apogeeTime = time;
    }

    // Track max velocity
    if (velocityMag > maxVelocity) {
      maxVelocity = velocityMag;
    }

    // Update state
    state = newState;
    time += DT;

    // Launch detection
    if (state[1] > 0.1) hasLaunched = true;

    // Ground impact detection
    if (hasLaunched && state[1] < GROUND_TOLERANCE) {
      // Add final ground point
      data.push({
        time: parseFloat(time.toFixed(3)),
        altitude: 0,
        range: state[0],
        velocity: 0,
        velocityX: 0,
        velocityY: 0,
        acceleration: 0,
        thrust: 0,
        drag: 0,
        mass: currentMass,
        airDensity: k1.atmos.rho,
        cd: k1.cd
      });
      break;
    }
  }

  return {
    apogee,
    maxVelocity,
    flightTime: time,
    data,
    calculatedMass: dryMass,
    calculatedArea: refArea
  };
};
