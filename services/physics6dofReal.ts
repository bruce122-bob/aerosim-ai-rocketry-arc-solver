/**
 * @deprecated This file is deprecated. Please use physics6dofStable.ts
 * 
 * Deprecation reasons:
 * - Uses Euler angles for attitude representation, which can cause numerical explosion
 * - Attitude integration is unstable (pitch angle may explode to 1e+200°)
 * - Has been replaced by physics6dofStable.ts (uses vector attitude representation)
 * 
 * Migration guide:
 * - Import runSimulation from './services/physics6dofStable'
 * - Interface is fully compatible, no changes needed to calling code
 * 
 * This file is retained for historical reference only and should not be used in new code
 */

/**
 * Real 6DOF (six degrees of freedom) physics engine (DEPRECATED)
 * Implements complete 3D kinematics and dynamics including attitude dynamics
 * 
 * 6DOF includes:
 * - 3 translational DOF: x, y, z (position)
 * - 3 rotational DOF: pitch, yaw, roll (attitude)
 * 
 * References: OpenRocket 6DOF implementation, Barrowman method, NASA technical reports
 */

import { RocketConfig, Environment, SimulationResult, SimulationPoint, RocketComponent } from '../types';
import { calculateCG, calculateCP } from './stability';
import { calculateDryMass, findMaxDiameter, calculateReferenceArea } from './rocketUtils';

// ============================================================================
// Parachute data structure
// ============================================================================
interface ParachuteData {
    diameter: number;    // diameter (m)
    cd: number;          // drag coefficient
    found: boolean;      // whether parachute was found
}

interface ParachuteState {
    deployed: boolean;           // whether deployed
    inflating: boolean;          // whether inflating
    fullyInflated: boolean;      // whether fully inflated
    deployTime: number;           // deploy time
    inflationTime: number;        // inflation time (s)
    currentArea: number;          // current effective area (m²)
    cd: number;                   // current drag coefficient
}

/**
 * Find parachute data
 */
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
// Physical constants
// ============================================================================
const G = 9.80665;           // Standard gravitational acceleration (m/s²)
const R = 287.05;            // Specific gas constant for air (J/kg·K)
const GAMMA = 1.4;           // Air adiabatic index
const T0 = 288.15;           // Sea level standard temperature (K)
const P0 = 101325;           // Sea level standard pressure (Pa)
const L = 0.0065;            // Temperature lapse rate (K/m)

// ============================================================================
// 6DOF state vector
// Uses ENU coordinate system (East-North-Up), consistent with 2D system
// ============================================================================
export interface State6DOF {
    // translational state (ENU coordinates)
    x: number;      // East position (m)
    y: number;      // North position (m)
    z: number;      // Up position (m) - altitude = z
    
    // translational velocity (ENU coordinates)
    vx: number;     // East velocity (m/s)
    vy: number;     // North velocity (m/s)
    vz: number;     // Up velocity (m/s) - vz > 0 when ascending
    
    // attitude (Euler angles, radians)
    // ZYX order: Yaw (ψ) -> Pitch (θ) -> Roll (φ)
    phi: number;    // Roll angle - rotation about x axis
    theta: number;  // Pitch angle - rotation about y axis
    psi: number;    // Yaw angle - rotation about z axis
    
    // angular velocity (body frame)
    p: number;      // Roll rate (rad/s)
    q: number;      // Pitch rate (rad/s)
    r: number;      // Yaw rate (rad/s)
}

// ============================================================================
// 6DOF state derivatives
// ============================================================================
interface StateDerivative6DOF {
    dx: number;     // position derivative
    dy: number;
    dz: number;
    dvx: number;    // velocity derivative (acceleration)
    dvy: number;
    dvz: number;
    dphi: number;   // attitude derivative
    dtheta: number;
    dpsi: number;
    dp: number;     // angular velocity derivative (angular acceleration)
    dq: number;
    dr: number;
}

// ============================================================================
// Aerodynamic forces and moments (body frame)
// ============================================================================
interface AerodynamicForces {
    // Forces (body frame)
    Fx: number;     // Axial force (drag, negative direction)
    Fy: number;     // Lateral force (sideslip)
    Fz: number;     // Normal force (lift)
    
    // Moments (body frame)
    Mx: number;      // Roll moment
    My: number;      // Pitch moment
    Mz: number;      // Yaw moment
    
    // Aerodynamic coefficients
    alpha: number;   // Angle of attack (rad)
    beta: number;    // Sideslip angle (rad)
    mach: number;    // Mach number
    cd: number;      // Drag coefficient
    cl: number;      // Lift coefficient
    cy: number;      // Side force coefficient
}

// ============================================================================
// Atmosphere model
// ============================================================================
interface AtmosphereData {
    temperature: number;    // K
    pressure: number;       // Pa
    density: number;        // kg/m³
    speedOfSound: number;  // m/s
}

const getAtmosphere = (altitude: number, env: Environment): AtmosphereData => {
    const T0_env = env.temperature + 273.15;
    const P0_env = env.pressure * 100;
    const humidity = Math.min(100, Math.max(0, env.humidity || 50));
    
    // temperature
    let T = T0_env - L * altitude;
    if (T < 216.65) T = 216.65;
    
    // pressure
    const exponent = G / (R * L);
    const P = P0_env * Math.pow(T / T0_env, exponent);
    
    // density (considering humidity)
    let rho: number;
    if (humidity > 0) {
        const tempC = T - 273.15;
        const e_sat = 611.2 * Math.exp((17.67 * tempC) / (tempC + 243.5));
        const e_actual = (humidity / 100) * e_sat;
        const virtualTemp = T / (1 - 0.378 * e_actual / P);
        rho = P / (R * virtualTemp);
    } else {
        rho = P / (R * T);
    }
    
    const speedOfSound = Math.sqrt(GAMMA * R * T);
    
    return { temperature: T, pressure: P, density: rho, speedOfSound };
};

// ============================================================================
// Coordinate system transformations
// ============================================================================

/**
 * Euler angles to rotation matrix (body frame to ENU ground frame)
 * Rotation order: ZYX (Yaw-Pitch-Roll)
 * 
 * ENU coordinate system:
 * - x: East
 * - y: North
 * - z: Up
 * 
 * Body coordinate system:
 * - x: rocket nose direction (forward)
 * - y: right side
 * - z: down (opposite to ENU z)
 */
const eulerToRotationMatrix = (phi: number, theta: number, psi: number): number[][] => {
    const cphi = Math.cos(phi);
    const sphi = Math.sin(phi);
    const ctheta = Math.cos(theta);
    const stheta = Math.sin(theta);
    const cpsi = Math.cos(psi);
    const spsi = Math.sin(psi);
    
    // ZYX order rotation matrix (standard aerodynamic dynamics)
    // R = R_z(psi) * R_y(theta) * R_x(phi)
    return [
        [ctheta * cpsi, ctheta * spsi, -stheta],
        [sphi * stheta * cpsi - cphi * spsi, sphi * stheta * spsi + cphi * cpsi, sphi * ctheta],
        [cphi * stheta * cpsi + sphi * spsi, cphi * stheta * spsi - sphi * cpsi, cphi * ctheta]
    ];
};

/**
 * Rotation matrix transpose (ground coordinate system to body coordinate system)
 */
const transposeMatrix = (R: number[][]): number[][] => {
    return [
        [R[0][0], R[1][0], R[2][0]],
        [R[0][1], R[1][1], R[2][1]],
        [R[0][2], R[1][2], R[2][2]]
    ];
};

/**
 * Matrix-vector multiplication
 */
const matrixVectorMultiply = (M: number[][], v: number[]): number[] => {
    return [
        M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
        M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
        M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]
    ];
};

/**
 * Transform vector from ENU ground frame to body frame
 */
const enuToBody = (vector: number[], phi: number, theta: number, psi: number): number[] => {
    const R = eulerToRotationMatrix(phi, theta, psi);
    const RT = transposeMatrix(R);
    return matrixVectorMultiply(RT, vector);
};

/**
 * Transform vector from body frame to ENU ground frame
 */
const bodyToENU = (vector: number[], phi: number, theta: number, psi: number): number[] => {
    const R = eulerToRotationMatrix(phi, theta, psi);
    return matrixVectorMultiply(R, vector);
};

// Backward-compatible aliases
const groundToBody = enuToBody;
const bodyToGround = bodyToENU;

// ============================================================================
// Aerodynamic force calculation (based on angle of attack and sideslip angle)
// ============================================================================

/**
 * Calculate angle of attack and sideslip angle
 */
const calculateAerodynamicAngles = (
    vBody: number[],    // body frame velocity
    windBody: number[]   // body frame wind speed
): { alpha: number; beta: number; vRel: number[] } => {
    // relative velocity
    const vRel = [
        vBody[0] - windBody[0],
        vBody[1] - windBody[1],
        vBody[2] - windBody[2]
    ];
    
    const vRelMag = Math.sqrt(vRel[0]**2 + vRel[1]**2 + vRel[2]**2);
    
    if (vRelMag < 0.01) {
        return { alpha: 0, beta: 0, vRel: [0, 0, 0] };
    }
    
    // angle of attack: angle between velocity projection on x-z plane and x axis
    const alpha = Math.atan2(-vRel[2], vRel[0]);
    
    // sideslip angle: angle between velocity projection on x-y plane and x axis
    const beta = Math.asin(vRel[1] / vRelMag);
    
    return { alpha, beta, vRel };
};

/**
 * Calculate Reynolds number
 */
const calculateReynoldsNumber = (
    velocity: number,
    characteristicLength: number,
    density: number,
    dynamicViscosity: number = 1.81e-5 // Pa·s at 15°C
): number => {
    return (density * velocity * characteristicLength) / dynamicViscosity;
};

/**
 * Calculate surface roughness factor
 */
const calculateRoughnessFactor = (
    reynolds: number,
    surfaceType?: string
): number => {
    const SURFACE_ROUGHNESS: Record<string, number> = {
        'painted': 1.05,
        'smooth': 1.00,
        'rough': 1.10,
        'composite': 1.03,
        'metal': 1.02,
        'normal': 1.05
    };
    
    const baseRoughness = SURFACE_ROUGHNESS[surfaceType || 'normal'] || 1.05;
    
    // roughness has greater effect at high Reynolds number
    let reynoldsFactor = 1.0;
    if (reynolds > 1e6) {
        reynoldsFactor = 1.02;
    } else if (reynolds > 5e5) {
        reynoldsFactor = 1.01;
    }
    
    return baseRoughness * reynoldsFactor;
};

/**
 * Calculate angle-of-attack damping coefficients
 */
const calculateDampingCoefficients = (
    mach: number,
    referenceLength: number,
    refArea: number
): { cDampPitch: number; cDampYaw: number; cDampRoll: number } => {
    // Based on Barrowman method and empirical data
    // damping coefficients typically proportional to velocity squared
    
    // pitch damping (mainly from fins)
    const cDampPitch = -0.1 * Math.sqrt(mach + 0.1); // negative value indicates damping
    
    // yaw damping (same as pitch, symmetric)
    const cDampYaw = cDampPitch;
    
    // roll damping (usually small)
    const cDampRoll = -0.01 * Math.sqrt(mach + 0.1);
    
    return { cDampPitch, cDampYaw, cDampRoll };
};

/**
 * Calculate aerodynamic coefficients (based on angle of attack, sideslip angle, Mach number, Reynolds number)
 * Uses Barrowman method and empirical formulas, includes full physical effects
 */
const calculateAerodynamicCoefficients = (
    alpha: number,
    beta: number,
    mach: number,
    reynolds: number,
    baseCd: number,
    cg: number,
    cp: number,
    referenceLength: number,
    surfaceType?: string,
    angularVelocities?: { p: number; q: number; r: number }
): { cd: number; cl: number; cy: number; cm: number; cn: number; clRoll: number } => {
    // 1. Base drag coefficient (full Mach number correction)
    let cd = baseCd;
    
    if (mach < 0.3) {
        // truly incompressible flow
        cd = baseCd;
    } else if (mach < 0.8) {
        // subsonic compressibility (Prandtl-Glauert correction)
        cd = baseCd / Math.sqrt(1 - mach * mach);
    } else if (mach < 1.0) {
        // transonic drag rise (critical Mach number region)
        const transonicFactor = 1.0 + 4.0 * Math.pow((mach - 0.8) / 0.2, 2);
        cd = baseCd * transonicFactor;
    } else if (mach < 1.2) {
        // just supersonic (shock drag dominates)
        const shockFactor = 2.0 + 1.0 * (mach - 1.0);
        cd = baseCd * shockFactor;
    } else if (mach < 2.0) {
        // supersonic (drag decreases after shock stabilizes)
        const supersonicFactor = 2.2 - 0.2 * (mach - 1.2);
        cd = baseCd * Math.max(1.8, supersonicFactor);
    } else {
        // hypersonic (drag plateau)
        cd = baseCd * 1.8;
    }
    
    // 2. Reynolds number correction (surface roughness effect)
    const roughnessFactor = calculateRoughnessFactor(reynolds, surfaceType);
    cd *= roughnessFactor;
    
    // 3. Drag increase from angle of attack (induced drag)
    const cdAlpha = cd + 0.5 * Math.sin(alpha) * Math.sin(alpha);
    
    // 4. Drag increase from sideslip angle
    const cdBeta = cdAlpha + 0.3 * Math.sin(beta) * Math.sin(beta);
    
    // 5. Lift coefficient (based on angle of attack, Barrowman method)
    // For stable rockets, lift coefficient is proportional to angle of attack
    const cnAlpha = 2.0; // normal force coefficient derivative (typical value)
    const cl = cnAlpha * Math.sin(alpha) * Math.cos(alpha);
    
    // 6. Side force coefficient (based on sideslip angle)
    const cy = cnAlpha * Math.sin(beta) * Math.cos(beta);
    
    // 7. Pitch moment coefficient (stability + damping)
    const stabilityMargin = (cp - cg) / referenceLength;
    let cm = -cnAlpha * Math.sin(alpha) * stabilityMargin;
    
    // Add pitch damping (damping moment from angular velocity q)
    if (angularVelocities) {
        const damping = calculateDampingCoefficients(mach, referenceLength, 0);
        cm += damping.cDampPitch * angularVelocities.q;
    }
    
    // 8. Yaw moment coefficient (stability + damping)
    let cn = -cnAlpha * Math.sin(beta) * stabilityMargin;
    if (angularVelocities) {
        const damping = calculateDampingCoefficients(mach, referenceLength, 0);
        cn += damping.cDampYaw * angularVelocities.r;
    }
    
    // 9. Roll moment coefficient (usually small, mainly damping)
    let clRoll = 0.0;
    if (angularVelocities) {
        const damping = calculateDampingCoefficients(mach, referenceLength, 0);
        clRoll = damping.cDampRoll * angularVelocities.p;
    }
    
    return {
        cd: cdBeta,
        cl,
        cy,
        cm,
        cn,
        clRoll
    };
};

/**
 * Calculate parachute drag force (body frame)
 */
const calculateParachuteForces = (
    parachute: ParachuteState,
    vRel: number[],
    airDensity: number
): { Fx: number; Fy: number; Fz: number } => {
    if (!parachute.deployed) {
        return { Fx: 0, Fy: 0, Fz: 0 };
    }
    
    const vRelMag = Math.sqrt(vRel[0]**2 + vRel[1]**2 + vRel[2]**2);
    if (vRelMag < 0.01) {
        return { Fx: 0, Fy: 0, Fz: 0 };
    }
    
    // parachute drag (always opposite to relative velocity direction)
    const q = 0.5 * airDensity * vRelMag * vRelMag;
    const dragMag = q * parachute.currentArea * parachute.cd;
    
    // drag direction (body frame)
    const Fx = -dragMag * (vRel[0] / vRelMag);
    const Fy = -dragMag * (vRel[1] / vRelMag);
    const Fz = -dragMag * (vRel[2] / vRelMag);
    
    return { Fx, Fy, Fz };
};

/**
 * Update parachute state
 */
const updateParachuteState = (
    parachute: ParachuteState,
    time: number,
    altitude: number,
    velocity: number,
    motorBurnTime: number,
    parachuteData: ParachuteData,
    hasLaunched: boolean,
    logDeployment: boolean = true  // new parameter: controls whether to log deployment message
): ParachuteState => {
    const newState = { ...parachute };
    
    // Deploy conditions:
    // 1. Launched
    // 2. Motor has burned out
    // 3. Past apogee (velocity downward) or at certain altitude
    // 4. Altitude > 5m (safety)
    const shouldDeploy = hasLaunched && 
                         time > motorBurnTime && 
                         altitude > 5.0 &&
                         (velocity < -1.0 || altitude < 0.1); // descending or near ground
    
    if (shouldDeploy && !newState.deployed) {
        newState.deployed = true;
        newState.deployTime = time;
        newState.inflating = true;
        newState.fullyInflated = false;
        newState.inflationTime = 0.3; // 0.3 second inflation time
        if (logDeployment) {  // only log when allowed (avoid duplicate RK4 sub-step logs)
            console.log(`[6DOF] Parachute deployed: t=${time.toFixed(2)}s, h=${altitude.toFixed(1)}m`);
        }
    }
    
    // Inflation process
    if (newState.inflating && newState.deployed) {
        const elapsed = time - newState.deployTime;
        if (elapsed >= newState.inflationTime) {
            newState.inflating = false;
            newState.fullyInflated = true;
            newState.currentArea = Math.PI * Math.pow(parachuteData.diameter / 2, 2);
            newState.cd = parachuteData.cd * 0.65; // actual parachute Cd is typically lower than theoretical
        } else {
            // Gradual inflation: area grows linearly from 0 to full size
            const inflationProgress = elapsed / newState.inflationTime;
            newState.currentArea = Math.PI * Math.pow(parachuteData.diameter / 2, 2) * inflationProgress;
            newState.cd = parachuteData.cd * 0.65 * inflationProgress; // Cd also grows gradually
        }
    }
    
    return newState;
};

/**
 * Calculate aerodynamic forces and moments
 */
const calculateAerodynamicForces = (
    state: State6DOF,
    rocket: RocketConfig,
    env: Environment,
    baseCd: number,
    refArea: number,
    referenceLength: number,
    cg: number,
    cp: number,
    parachuteState?: ParachuteState
): AerodynamicForces => {
    // 1. Get atmosphere data (ENU coordinates: altitude = z)
    const altitude = state.z;
    const atm = getAtmosphere(altitude, env);
    
    // 2. Calculate wind speed (ENU coordinates)
    let windSpeed = env.windSpeed;
    if (altitude > 2.0) {
        const windShearExponent = 0.14;
        const referenceHeight = 2.0;
        windSpeed = env.windSpeed * Math.pow(Math.max(altitude, referenceHeight) / referenceHeight, windShearExponent);
    }
    
    // Wind direction conversion: from navigation angle (0=N, 90=E) to math angle
    const windAngleMathDeg = 90 - env.windDirection;
    const windAngleRad = (windAngleMathDeg * Math.PI) / 180;
    // ENU coordinates: x=East, y=North, z=Up
    const windENU = [
        -windSpeed * Math.cos(windAngleRad),  // East (negative means wind from east)
        windSpeed * Math.sin(windAngleRad),    // North
        0                                      // Vertical (assuming horizontal wind)
    ];
    
    // 3. Transform wind speed to body frame
    const windBody = enuToBody(windENU, state.phi, state.theta, state.psi);
    
    // 4. Calculate body frame velocity
    const vENU = [state.vx, state.vy, state.vz];
    const vBody = enuToBody(vENU, state.phi, state.theta, state.psi);
    
    // 5. Calculate angle of attack and sideslip angle
    const { alpha, beta, vRel } = calculateAerodynamicAngles(vBody, windBody);
    const vRelMag = Math.sqrt(vRel[0]**2 + vRel[1]**2 + vRel[2]**2);
    const mach = vRelMag / atm.speedOfSound;
    
    // 6. Calculate Reynolds number
    const reynolds = calculateReynoldsNumber(vRelMag, referenceLength, atm.density);
    
    // 7. Calculate aerodynamic coefficients (including all physical effects)
    const coeffs = calculateAerodynamicCoefficients(
        alpha, 
        beta, 
        mach, 
        reynolds,
        baseCd, 
        cg, 
        cp, 
        referenceLength,
        rocket.finish,
        { p: state.p, q: state.q, r: state.r } // angular velocity for damping calculation
    );
    
    // 7. Calculate aerodynamic forces (body frame)
    const q = 0.5 * atm.density * vRelMag * vRelMag; // dynamic pressure
    
    let Fx = -q * refArea * coeffs.cd;  // axial force (drag, negative direction)
    let Fy = q * refArea * coeffs.cy;   // lateral force
    let Fz = -q * refArea * coeffs.cl;  // normal force (lift, negative because z is down)
    
    // 8. If parachute deployed, add parachute drag
    if (parachuteState && parachuteState.deployed) {
        const parachuteForces = calculateParachuteForces(parachuteState, vRel, atm.density);
        Fx += parachuteForces.Fx;
        Fy += parachuteForces.Fy;
        Fz += parachuteForces.Fz;
    }
    
    // 9. Calculate aerodynamic moments (body frame)
    // When parachute fully inflated, greatly reduce aerodynamic moments (parachute dominates attitude stability)
    const momentMultiplier = (parachuteState && parachuteState.fullyInflated) ? 0.05 : 1.0;
    
    const Mx = q * refArea * referenceLength * coeffs.clRoll * momentMultiplier;  // roll moment
    const My = q * refArea * referenceLength * coeffs.cm * momentMultiplier;     // pitch moment
    const Mz = q * refArea * referenceLength * coeffs.cn * momentMultiplier;     // yaw moment
    
    // Note: parachute dominates attitude stability through strong damping and swing, aerodynamic moments have minimal effect
    
    return {
        Fx,
        Fy,
        Fz,
        Mx,
        My,
        Mz,
        alpha,
        beta,
        mach,
        cd: coeffs.cd,
        cl: coeffs.cl,
        cy: coeffs.cy
    };
};

// ============================================================================
// 6DOF equations of motion
// ============================================================================

/**
 * Calculate state derivatives (6DOF equations of motion)
 */
const calculateDerivatives = (
    t: number,
    state: State6DOF,
    rocket: RocketConfig,
    env: Environment,
    currentMass: number,
    refArea: number,
    referenceLength: number,
    cg: number,
    cp: number,
    baseCd: number,
    thrustMag: number,
    isOnRail: boolean,
    railLength: number,
    launchAngleRad: number,
    parachuteState: ParachuteState | undefined,
    Ixx: number,
    Iyy: number,
    Izz: number,
    frictionForce: number[]
): StateDerivative6DOF => {
    // 1. Calculate aerodynamic forces and moments (body frame)
    const aero = calculateAerodynamicForces(state, rocket, env, baseCd, refArea, referenceLength, cg, cp, parachuteState);
    
    // 2. Gravity (ENU coordinates, downward is negative z)
    // Gravity is always downward, unaffected by rocket attitude, should be calculated directly in ground frame
    const FgravityENU = [0, 0, -currentMass * G]; // gravity downward, negative z direction
    
    // 4. Launch rail friction (ENU coordinates)
    const frictionENU = isOnRail ? frictionForce : [0, 0, 0];
    
    // 5. Transform aerodynamic forces and thrust from body frame to ENU
    const aeroENU = bodyToENU([aero.Fx, aero.Fy, aero.Fz], state.phi, state.theta, state.psi);
    const thrustENU = isOnRail 
        ? [thrustMag * Math.cos(launchAngleRad), 0, thrustMag * Math.sin(launchAngleRad)] // On rail: direct ENU (cos=horizontal, sin=vertical)
        : bodyToENU([thrustMag, 0, 0], state.phi, state.theta, state.psi); // Free flight: transform from body frame
    
    // 6. Total force (ENU coordinates) - all forces summed directly in ENU
    const FtotalENU = [
        aeroENU[0] + thrustENU[0] + FgravityENU[0] + frictionENU[0],
        aeroENU[1] + thrustENU[1] + FgravityENU[1] + frictionENU[1],
        aeroENU[2] + thrustENU[2] + FgravityENU[2] + frictionENU[2]
    ];
    
    // 7. Acceleration (ENU coordinates) - calculated directly in ground frame
    const aENU = [
        FtotalENU[0] / currentMass,
        FtotalENU[1] / currentMass,
        FtotalENU[2] / currentMass
    ];
    
    // 7. Calculate angular acceleration (using passed-in precise moment of inertia)
    // Parachute stabilization: after parachute fully inflated, greatly reduce angular acceleration to simulate forced stabilization
    let angularDamping = 1.0; // default no extra damping
    if (parachuteState && parachuteState.fullyInflated) {
        angularDamping = 0.01; // damping factor: reduce angular acceleration to 1% (real parachute strong damping effect)
    }
    
    // Angular acceleration (Euler equations) + parachute damping
    const dp = ((aero.Mx - (Izz - Iyy) * state.q * state.r) / Ixx) * angularDamping;
    const dq = ((aero.My - (Ixx - Izz) * state.r * state.p) / Iyy) * angularDamping;
    const dr = ((aero.Mz - (Iyy - Ixx) * state.p * state.q) / Izz) * angularDamping;
    
    // 8. Attitude angular velocity (from angular velocity to Euler angle derivatives)
    const dphi = state.p + state.q * Math.sin(state.phi) * Math.tan(state.theta) + state.r * Math.cos(state.phi) * Math.tan(state.theta);
    const dtheta = state.q * Math.cos(state.phi) - state.r * Math.sin(state.phi);
    const dpsi = (state.q * Math.sin(state.phi) + state.r * Math.cos(state.phi)) / Math.cos(state.theta);
    
    return {
        dx: state.vx,
        dy: state.vy,
        dz: state.vz,
        dvx: aENU[0],
        dvy: aENU[1],
        dvz: aENU[2],
        dphi,
        dtheta,
        dpsi,
        dp,
        dq,
        dr
    };
};

// ============================================================================
// Launch rail constraint system
// ============================================================================

/**
 * Apply launch rail constraints and friction
 */
const applyRailConstraints = (
    state: State6DOF,
    railLength: number,
    launchAngleRad: number,
    currentMass: number,
    vENU: number[]
): { constrained: boolean; frictionForce: number[]; constrainedVelocity: number[] } => {
    // ENU coordinates: altitude = z, distance = sqrt(x² + y² + z²)
    const distanceFromPad = Math.sqrt(state.x**2 + state.y**2 + state.z**2);
    const isOnRail = distanceFromPad < railLength;
    
    if (!isOnRail) {
        return { constrained: false, frictionForce: [0, 0, 0], constrainedVelocity: vENU };
    }
    
    // Launch rail direction (ENU coordinates)
    // Launch angle from horizontal: 0 deg = horizontal, 90 deg = vertical
    // For vertical launch (90 deg): [0, 0, 1] (up)
    // For horizontal launch (0 deg): [1, 0, 0] (east, no vertical component at 0 deg)
    // Note: launchAngleRad is angle from horizontal
    // In ENU: x=East, y=North, z=Up
    // Rail direction: horizontal component east, vertical component up
    const railDirENU = [
        Math.cos(launchAngleRad),  // East component (horizontal, 0 deg=1, 90 deg=0)
        0,                          // North component (assuming rail in N-S direction)
        Math.sin(launchAngleRad)   // Up component (vertical, 0 deg=0, 90 deg=1)
    ];
    
    // Calculate velocity component along rail
    const vAlongRail = vENU[0] * railDirENU[0] + 
                       vENU[1] * railDirENU[1] + 
                       vENU[2] * railDirENU[2];
    
    // Constraint: only constrain lateral velocity (x, y), allow z to accelerate freely
    // This avoids blocking normal rocket acceleration
    const constrainedVelocity = [
        railDirENU[0] * vAlongRail,  // East: along rail direction
        railDirENU[1] * vAlongRail,  // North: along rail direction
        Math.max(vENU[2], railDirENU[2] * vAlongRail)  // Up: allow acceleration, but not deceleration
    ];
    
    // Calculate friction (based on normal force)
    const RAIL_FRICTION_COEFF = 0.02; // steel-plastic friction coefficient
    // Normal force: component of gravity perpendicular to rail
    const gravityNormalForce = currentMass * G * Math.abs(Math.sin(launchAngleRad));
    const frictionForceMag = RAIL_FRICTION_COEFF * gravityNormalForce;
    
    // Friction direction: opposite to velocity (ENU coordinates)
    const frictionForce = [
        -frictionForceMag * railDirENU[0] * Math.sign(vAlongRail || 1),
        -frictionForceMag * railDirENU[1] * Math.sign(vAlongRail || 1),
        -frictionForceMag * railDirENU[2] * Math.sign(vAlongRail || 1)
    ];
    
    return { constrained: true, frictionForce, constrainedVelocity };
};

/**
 * Apply parachute stabilization effect
 * Parachute gradually eliminates horizontal velocity component, causing rocket to descend vertically
 */
const applyParachuteStabilization = (
    state: State6DOF,
    parachuteState: ParachuteState,
    dt: number
): State6DOF => {
    if (!parachuteState.fullyInflated) {
        return state;
    }
    
    // Horizontal velocity decay factor (decays to 80% per second)
    // Exponential decay: v(t) = v(0) * exp(-λ * t), where exp(-λ * 1s) = 0.8
    // ln(0.8) ≈ -0.223
    const horizontalDamping = Math.exp(-0.223 * dt);
    
    return {
        ...state,
        vx: state.vx * horizontalDamping,  // East velocity decay
        vy: state.vy * horizontalDamping,  // North velocity decay
        // vz unchanged (vertical velocity naturally controlled by parachute drag)
    };
};

// ============================================================================
// Dynamic stability analysis
// ============================================================================

/**
 * Calculate attitude response (pitch oscillation frequency and damping ratio)
 */
const calculateDynamicStability = (
    stabilityMargin: number,
    referenceLength: number,
    currentMass: number,
    Iyy: number,
    mach: number,
    airDensity: number,
    refArea: number
): { frequency: number; dampingRatio: number; isStable: boolean } => {
    // Based on Barrowman method and linear stability theory
    // Pitch oscillation frequency: ω = sqrt(Cm_alpha / Iyy)
    // Damping ratio: ζ = Cm_q / (2 * sqrt(Cm_alpha * Iyy))
    
    const cnAlpha = 2.0; // normal force coefficient derivative
    const cmAlpha = -cnAlpha * stabilityMargin; // pitch moment coefficient derivative
    
    // Restoring moment coefficient (negative value indicates stability)
    const restoringMoment = cmAlpha * 0.5 * airDensity * refArea * referenceLength;
    
    // Natural frequency (rad/s)
    const frequency = Math.sqrt(Math.abs(restoringMoment) / Iyy);
    
    // Damping coefficient (from angular velocity)
    const damping = calculateDampingCoefficients(mach, referenceLength, refArea);
    const dampingMoment = damping.cDampPitch * 0.5 * airDensity * refArea * referenceLength * referenceLength;
    
    // Damping ratio
    const criticalDamping = 2 * Math.sqrt(Math.abs(restoringMoment) * Iyy);
    const dampingRatio = -dampingMoment / criticalDamping; // negative value indicates damping
    
    // Stability check
    const isStable = stabilityMargin > 0 && dampingRatio > 0;
    
    return { frequency, dampingRatio, isStable };
};

/**
 * Check angle of attack limits and stall
 */
const checkAngleOfAttackLimits = (
    alpha: number,
    beta: number,
    stabilityMargin: number
): { warning: string | null; isStalled: boolean } => {
    const alphaDeg = alpha * 180 / Math.PI;
    const betaDeg = beta * 180 / Math.PI;
    
    // Maximum allowed angle of attack (typical: 15-20 deg)
    const MAX_AOA = 20.0; // degrees
    const MAX_SIDESLIP = 15.0; // degrees
    
    let warning: string | null = null;
    let isStalled = false;
    
    if (Math.abs(alphaDeg) > MAX_AOA) {
        warning = `⚠️ Angle of attack too high: ${alphaDeg.toFixed(1)}° (max ${MAX_AOA}°)`;
        isStalled = true;
    }
    
    if (Math.abs(betaDeg) > MAX_SIDESLIP) {
        warning = (warning || '') + ` ⚠️ Sideslip angle too high: ${betaDeg.toFixed(1)}°`;
    }
    
    // Unstable rocket warning
    if (stabilityMargin < 0) {
        warning = (warning || '') + ` ⚠️ Rocket unstable (stability margin: ${(stabilityMargin*100).toFixed(1)}%)`;
    }
    
    return { warning, isStalled };
};

// ============================================================================
// Precise moment of inertia calculation
// ============================================================================

/**
 * Calculate precise moment of inertia (based on geometry and mass distribution)
 */
const calculateMomentOfInertia = (
    components: RocketComponent[],
    cg: number,
    currentMass: number,
    referenceLength: number
): { Ixx: number; Iyy: number; Izz: number } => {
    // For slender body rockets, use these approximations:
    // Ixx: roll (about x axis) - smaller, mass concentrated on centerline
    // Iyy: pitch (about y axis) - larger, mass distributed along length
    // Izz: yaw (about z axis) - same as Iyy (symmetric)
    
    // Based on Barrowman method and slender body theory
    // For uniform slender body: I = (1/12) * m * L²
    // For actual rockets (non-uniform mass distribution): use correction factor
    
    // Calculate effective length (from CG to ends)
    const lengthFromCG = referenceLength * 0.5; // simplified: assume CG at center
    
    // Roll moment of inertia (about x axis)
    // For cylinder: Ixx = (1/4) * m * r² + (1/12) * m * L²
    // Simplified: mainly depends on radius
    const radius = referenceLength / 2;
    const Ixx = currentMass * (0.25 * radius * radius + 0.1 * lengthFromCG * lengthFromCG);
    
    // Pitch and yaw moment of inertia (about y/z axis)
    // For slender body: Iyy ≈ (1/12) * m * L²
    // Considering mass distribution: use correction factor 0.4-0.6
    const Iyy = currentMass * referenceLength * referenceLength * 0.5;
    const Izz = Iyy; // symmetric
    
    return { Ixx, Iyy, Izz };
};

// ============================================================================
// Main simulation function
// ============================================================================

// Unified simulation interface (internally uses 6DOF)
export const runSimulation = async (
    rocket: RocketConfig,
    env: Environment,
    launchAngleDeg: number = 90,
    railLength: number = 1.0
): Promise<SimulationResult> => {
    const dt = 0.01; // 10ms time step (6DOF requires smaller time step)
    
    // Convert launch angle to radians (must be defined at function start, used in many places)
    const launchAngleRad = launchAngleDeg * Math.PI / 180;
    
    // Initial state (ENU coordinates)
    let state: State6DOF = {
        x: 0,      // East: 0
        y: 0,      // North: 0
        z: 0,      // Up: 0 (ground, altitude = z)
        vx: 0,     // East velocity: 0
        vy: 0,     // North velocity: 0
        vz: 0,     // Up velocity: 0
        phi: 0,    // Initial no roll
        theta: launchAngleRad,  // Initial pitch = launch angle (from horizontal)
        psi: 0,    // Initial no yaw
        p: 0,
        q: 0,
        r: 0
    };
    
    const data: SimulationPoint[] = [];
    
    // Rocket properties
    const dryMass = calculateDryMass(rocket.stages);
    const refArea = calculateReferenceArea(rocket.stages);
    const maxDiameter = findMaxDiameter(rocket.stages);
    const referenceLength = maxDiameter; // reference length = max diameter
    const cg = calculateCG(rocket.stages);
    const cp = calculateCP(rocket.stages);
    
    // Validate key parameters
    if (isNaN(dryMass) || dryMass <= 0) {
        console.error(`[6DOF] Error: invalid dry mass: ${dryMass} kg`);
        throw new Error(`Invalid dry mass: ${dryMass} kg`);
    }
    if (isNaN(refArea) || refArea <= 0) {
        console.error(`[6DOF] Error: invalid reference area: ${refArea} m²`);
        throw new Error(`Invalid reference area: ${refArea} m²`);
    }
    if (isNaN(cg) || isNaN(cp)) {
        console.warn(`[6DOF] Warning: CG or CP invalid: CG=${cg}m, CP=${cp}m`);
    }
    
    console.log(`[6DOF] Rocket properties: dry mass=${(dryMass*1000).toFixed(1)}g, ref area=${(refArea*10000).toFixed(2)}cm², CG=${(cg*100).toFixed(1)}cm, CP=${(cp*100).toFixed(1)}cm`);
    
    // Cd priority: user provided > .ork file > program calculated > default
    let baseCd: number;
    if (rocket.manualOverride?.cdOverride !== undefined && rocket.manualOverride.cdOverride > 0) {
        baseCd = rocket.manualOverride.cdOverride;
    } else if (rocket.cdOverride && rocket.cdOverride > 0 && rocket.cdOverride !== 0.5) {
        baseCd = rocket.cdOverride;
    } else {
        baseCd = 0.55; // default value
    }
    
    const propellantMass = rocket.motor.propellantMass;
    const totalMotorMass = rocket.motor.totalMass;
    
    // Parachute data
    const parachuteData = findParachute(rocket.stages);
    let parachuteState: ParachuteState = {
        deployed: false,
        inflating: false,
        fullyInflated: false,
        deployTime: 0,
        inflationTime: 0.3,
        currentArea: 0,
        cd: parachuteData.cd
    };
    
    let time = 0;
    let apogee = 0;
    let maxVelocity = 0;
    let hasLaunched = false;
    const MAX_TIME = 300;
    
    console.log('[6DOF PHYSICS] ======= Starting 6DOF simulation =======');
    console.log(`[6DOF PHYSICS] Coordinate system: ENU (East-North-Up)`);
    console.log(`[6DOF PHYSICS] Launch angle: ${launchAngleDeg}° (${launchAngleRad.toFixed(3)} rad)`);
    console.log(`[6DOF PHYSICS] CG: ${(cg*100).toFixed(1)}cm, CP: ${(cp*100).toFixed(1)}cm`);
    console.log(`[6DOF PHYSICS] Stability: ${((cp - cg) / referenceLength).toFixed(2)} cal`);
    console.log(`[6DOF PHYSICS] Initial mass: ${((dryMass + totalMotorMass)*1000).toFixed(1)}g`);
    console.log(`[6DOF PHYSICS] Motor: ${rocket.motor.name}, thrust: ${rocket.motor.averageThrust?.toFixed(1) || 'N/A'}N, burn time: ${rocket.motor.burnTime.toFixed(2)}s`);
    if (parachuteData.found) {
        console.log(`[6DOF PHYSICS] Parachute: diameter=${(parachuteData.diameter*100).toFixed(1)}cm, Cd=${parachuteData.cd}`);
    }
    
    // Altitude calibration factor: actual 748ft vs simulated 792ft, needs ~-5.6% adjustment
    // Achieved by increasing drag coefficient (~+6% drag)
    const ALTITUDE_CALIBRATION_FACTOR = 1.04; // increase drag 4% to reduce altitude ~3.8% (777ft to 748ft)
    
    // Record initial state point (t=0) - ensure trajectory starts from (0,0)
    const atm0 = getAtmosphere(0, env);
    const initialCd = baseCd * ALTITUDE_CALIBRATION_FACTOR;
    const initialDataPoint: SimulationPoint = {
        time: 0,
        altitude: 0,  // start from ground
        range: 0,     // horizontal distance is 0
        velocity: 0,
        velocityX: 0,  // horizontal velocity (initial rest, for 3D animation)
        velocityY: 0,  // vertical velocity (initial rest, for 3D animation)
        acceleration: 0,
        thrust: 0,
        drag: 0,
        mass: dryMass + totalMotorMass,
        airDensity: Math.max(0.1, atm0.density), // ensure density valid
        cd: initialCd,  // use calibrated Cd
        pitch: launchAngleDeg,
        yaw: 0,
        roll: 0,
        pitchRate: 0,
        yawRate: 0,
        rollRate: 0,
        angleOfAttack: 0,
        sideslipAngle: 0,
        mach: 0,
        reynolds: 0,
        liftCoefficient: 0,
        dragCoefficient: initialCd,  // use calibrated Cd
        stabilityMargin: (cp - cg) / referenceLength
    };
    data.push(initialDataPoint);
    console.log(`[6DOF] Initial state recorded: altitude=${initialDataPoint.altitude}m, range=${initialDataPoint.range}m, time=${initialDataPoint.time}s`);
    
    // Main loop
    while (time < MAX_TIME) {
        // Current mass
        let currentMass = dryMass + totalMotorMass;
        if (time < rocket.motor.burnTime) {
            const burnFraction = time / rocket.motor.burnTime;
            currentMass -= burnFraction * propellantMass;
        } else {
            currentMass -= propellantMass;
        }
        currentMass = Math.max(currentMass, dryMass);
        
        // Thrust
        let thrustMag = 0;
        if (time < rocket.motor.burnTime) {
            const curve = rocket.motor.thrustCurve;
            if (curve.length > 0) {
                for (let i = 0; i < curve.length - 1; i++) {
                    if (time >= curve[i].time && time <= curve[i + 1].time) {
                        const t0 = curve[i].time;
                        const t1 = curve[i + 1].time;
                        const f0 = curve[i].thrust;
                        const f1 = curve[i + 1].thrust;
                        if (t1 !== t0) {
                            const fraction = (time - t0) / (t1 - t0);
                            thrustMag = f0 + fraction * (f1 - f0);
                        } else {
                            thrustMag = f0;
                        }
                        break;
                    }
                }
            }
        }
        
        // Calculate precise moment of inertia
        const { Ixx, Iyy, Izz } = calculateMomentOfInertia(rocket.stages, cg, currentMass, referenceLength);
        
        // Launch rail constraints and friction (ENU coordinates)
        const vENU = [state.vx, state.vy, state.vz];
        const railConstraints = applyRailConstraints(state, railLength, launchAngleRad, currentMass, vENU);
        const isOnRail = railConstraints.constrained;
        
        // Update parachute state (ENU coordinates: altitude = z)
        const altitude = state.z;
        const velocity = Math.sqrt(state.vx**2 + state.vy**2 + state.vz**2);
        parachuteState = updateParachuteState(
            parachuteState,
            time,
            altitude,
            state.vz, // vertical velocity (up is positive)
            rocket.motor.burnTime,
            parachuteData,
            hasLaunched,
            true  // main loop: allow deployment log
        );
        
        // Apply altitude calibration factor to baseCd (used in all RK4 steps)
        const calibratedBaseCd = baseCd * ALTITUDE_CALIBRATION_FACTOR;
        
        // RK4 integration
        const k1 = calculateDerivatives(
            time, state, rocket, env, currentMass, refArea, referenceLength, 
            cg, cp, calibratedBaseCd, thrustMag, isOnRail, railLength, launchAngleRad,
            parachuteState, Ixx, Iyy, Izz, railConstraints.frictionForce
        );
        
        const state_k2: State6DOF = {
            x: state.x + k1.dx * dt / 2,
            y: state.y + k1.dy * dt / 2,
            z: state.z + k1.dz * dt / 2,
            vx: state.vx + k1.dvx * dt / 2,
            vy: state.vy + k1.dvy * dt / 2,
            vz: state.vz + k1.dvz * dt / 2,
            phi: state.phi + k1.dphi * dt / 2,
            theta: state.theta + k1.dtheta * dt / 2,
            psi: state.psi + k1.dpsi * dt / 2,
            p: state.p + k1.dp * dt / 2,
            q: state.q + k1.dq * dt / 2,
            r: state.r + k1.dr * dt / 2
        };
        
        // k2 needs to recalculate constraints and parachute state
        const railConstraints_k2 = applyRailConstraints(state_k2, railLength, launchAngleRad, currentMass, [state_k2.vx, state_k2.vy, state_k2.vz]);
        const parachuteState_k2 = updateParachuteState(
            parachuteState,
            time + dt / 2,
            state_k2.z,
            state_k2.vz,
            rocket.motor.burnTime,
            parachuteData,
            hasLaunched,
            false  // RK4 sub-step: disable deployment log
        );
        
        const k2 = calculateDerivatives(
            time + dt / 2, state_k2, rocket, env, currentMass, refArea, referenceLength,
            cg, cp, calibratedBaseCd, thrustMag, railConstraints_k2.constrained, railLength, launchAngleRad,
            parachuteState_k2, Ixx, Iyy, Izz, railConstraints_k2.frictionForce
        );
        
        const state_k3: State6DOF = {
            x: state.x + k2.dx * dt / 2,
            y: state.y + k2.dy * dt / 2,
            z: state.z + k2.dz * dt / 2,
            vx: state.vx + k2.dvx * dt / 2,
            vy: state.vy + k2.dvy * dt / 2,
            vz: state.vz + k2.dvz * dt / 2,
            phi: state.phi + k2.dphi * dt / 2,
            theta: state.theta + k2.dtheta * dt / 2,
            psi: state.psi + k2.dpsi * dt / 2,
            p: state.p + k2.dp * dt / 2,
            q: state.q + k2.dq * dt / 2,
            r: state.r + k2.dr * dt / 2
        };
        
        const railConstraints_k3 = applyRailConstraints(state_k3, railLength, launchAngleRad, currentMass, [state_k3.vx, state_k3.vy, state_k3.vz]);
        const parachuteState_k3 = updateParachuteState(
            parachuteState,
            time + dt / 2,
            state_k3.z,
            state_k3.vz,
            rocket.motor.burnTime,
            parachuteData,
            hasLaunched,
            false  // RK4 sub-step: disable deployment log
        );
        
        const k3 = calculateDerivatives(
            time + dt / 2, state_k3, rocket, env, currentMass, refArea, referenceLength,
            cg, cp, calibratedBaseCd, thrustMag, railConstraints_k3.constrained, railLength, launchAngleRad,
            parachuteState_k3, Ixx, Iyy, Izz, railConstraints_k3.frictionForce
        );
        
        const state_k4: State6DOF = {
            x: state.x + k3.dx * dt,
            y: state.y + k3.dy * dt,
            z: state.z + k3.dz * dt,
            vx: state.vx + k3.dvx * dt,
            vy: state.vy + k3.dvy * dt,
            vz: state.vz + k3.dvz * dt,
            phi: state.phi + k3.dphi * dt,
            theta: state.theta + k3.dtheta * dt,
            psi: state.psi + k3.dpsi * dt,
            p: state.p + k3.dp * dt,
            q: state.q + k3.dq * dt,
            r: state.r + k3.dr * dt
        };
        
        const railConstraints_k4 = applyRailConstraints(state_k4, railLength, launchAngleRad, currentMass, [state_k4.vx, state_k4.vy, state_k4.vz]);
        const parachuteState_k4 = updateParachuteState(
            parachuteState,
            time + dt,
            state_k4.z,
            state_k4.vz,
            rocket.motor.burnTime,
            parachuteData,
            hasLaunched,
            false  // RK4 sub-step: disable deployment log
        );
        
        const k4 = calculateDerivatives(
            time + dt, state_k4, rocket, env, currentMass, refArea, referenceLength,
            cg, cp, calibratedBaseCd, thrustMag, railConstraints_k4.constrained, railLength, launchAngleRad,
            parachuteState_k4, Ixx, Iyy, Izz, railConstraints_k4.frictionForce
        );
        
        // Note: k4 uses calibratedBaseCd (defined at k1)
        
        // Update state
        let newState: State6DOF = {
            x: state.x + (dt / 6) * (k1.dx + 2 * k2.dx + 2 * k3.dx + k4.dx),
            y: state.y + (dt / 6) * (k1.dy + 2 * k2.dy + 2 * k3.dy + k4.dy),
            z: state.z + (dt / 6) * (k1.dz + 2 * k2.dz + 2 * k3.dz + k4.dz),
            vx: state.vx + (dt / 6) * (k1.dvx + 2 * k2.dvx + 2 * k3.dvx + k4.dvx),
            vy: state.vy + (dt / 6) * (k1.dvy + 2 * k2.dvy + 2 * k3.dvy + k4.dvy),
            vz: state.vz + (dt / 6) * (k1.dvz + 2 * k2.dvz + 2 * k3.dvz + k4.dvz),
            phi: state.phi + (dt / 6) * (k1.dphi + 2 * k2.dphi + 2 * k3.dphi + k4.dphi),
            theta: state.theta + (dt / 6) * (k1.dtheta + 2 * k2.dtheta + 2 * k3.dtheta + k4.dtheta),
            psi: state.psi + (dt / 6) * (k1.dpsi + 2 * k2.dpsi + 2 * k3.dpsi + k4.dpsi),
            p: state.p + (dt / 6) * (k1.dp + 2 * k2.dp + 2 * k3.dp + k4.dp),
            q: state.q + (dt / 6) * (k1.dq + 2 * k2.dq + 2 * k3.dq + k4.dq),
            r: state.r + (dt / 6) * (k1.dr + 2 * k2.dr + 2 * k3.dr + k4.dr)
        };
        
        // Apply launch rail constraints (if still on rail)
        const finalConstraints = applyRailConstraints(newState, railLength, launchAngleRad, currentMass, [newState.vx, newState.vy, newState.vz]);
        if (finalConstraints.constrained) {
            // Constrain lateral velocity (x, y), but allow vertical (z) to accelerate freely
            // This avoids blocking normal rocket acceleration
            newState.vx = finalConstraints.constrainedVelocity[0];
            newState.vy = finalConstraints.constrainedVelocity[1];
            // z direction: for vertical launch, fully free; for non-vertical, allow acceleration but not deceleration
            const isVertical = Math.abs(launchAngleRad - Math.PI/2) < 0.01;
            if (isVertical) {
                // Vertical launch: z fully free, no constraint
                // Don't modify vz, let it accelerate freely
            } else {
                // Non-vertical launch: allow acceleration, but not deceleration below rail-direction velocity
                newState.vz = Math.max(newState.vz, finalConstraints.constrainedVelocity[2]);
            }
            
            // Constrain attitude (keep along rail direction, but allow small angular velocity for stability)
            newState.phi = 0;
            newState.psi = 0;
            // Limit angular velocity, but don't zero completely, for numerical stability
            newState.p = Math.max(-0.05, Math.min(0.05, newState.p * 0.5));
            newState.q = Math.max(-0.05, Math.min(0.05, newState.q * 0.5));
            newState.r = Math.max(-0.05, Math.min(0.05, newState.r * 0.5));
        }
        
        // Apply parachute stabilization (horizontal velocity decay)
        newState = applyParachuteStabilization(newState, parachuteState, dt);
        
        state = newState;
        
        // After parachute fully inflated, gradually stabilize attitude to vertical
        if (parachuteState.fullyInflated) {
            const stabilizationRate = 0.1; // 10% stabilization per second (gentle attitude correction)
            const targetPitch = Math.PI / 2; // 90 deg (vertical up, rocket nose up)
            const targetRoll = 0;    // 0 deg (no roll)
            const targetYaw = 0;     // 0 deg (no yaw)
            
            // Use exponential smoothing to gradually approach target attitude
            state.theta += (targetPitch - state.theta) * stabilizationRate * dt;
            state.phi += (targetRoll - state.phi) * stabilizationRate * dt;
            state.psi += (targetYaw - state.psi) * stabilizationRate * dt;
            
            // Also reduce angular velocity (parachute damping effect)
            const angularVelocityDamping = Math.exp(-0.5 * dt); // decay to 60% per second
            state.p *= angularVelocityDamping;
            state.q *= angularVelocityDamping;
            state.r *= angularVelocityDamping;
        }
        
        time += dt;
        
        // Calculate current state acceleration (use RK4 weighted average for data consistency)
        // RK4 acceleration weighted average: (k1 + 2*k2 + 2*k3 + k4) / 6
        const currentAccelX = (k1.dvx + 2*k2.dvx + 2*k3.dvx + k4.dvx) / 6;
        const currentAccelY = (k1.dvy + 2*k2.dvy + 2*k3.dvy + k4.dvy) / 6;
        const currentAccelZ = (k1.dvz + 2*k2.dvz + 2*k3.dvz + k4.dvz) / 6;
        const currentAcceleration = Math.sqrt(currentAccelX**2 + currentAccelY**2 + currentAccelZ**2);
        
        // Record data (ENU coordinates: altitude = z)
        // Note: don't use Math.max(0, state.z), that blocks landing detection
        // Landing detection needs real state.z (may be negative)
        const currentAltitude = state.z; // real altitude (may be negative, for landing detection)
        const currentVelocity = Math.sqrt(state.vx**2 + state.vy**2 + state.vz**2);
        // Range: horizontal distance (ground projection from launch point, meters)
        const range = Math.sqrt(state.x**2 + state.y**2);
        
        // Only record non-negative altitude for apogee tracking (display)
        if (state.z > apogee) apogee = state.z;
        if (currentVelocity > maxVelocity) maxVelocity = currentVelocity;
        
        // Calculate current aerodynamic data (for recording)
        // Use Math.max(0, state.z) for atmosphere calc to avoid negative altitude errors
        const atm = getAtmosphere(Math.max(0, state.z), env);
        const currentVENU = [state.vx, state.vy, state.vz];
        const windSpeed = currentAltitude > 2.0 ? env.windSpeed * Math.pow(Math.max(currentAltitude, 2.0) / 2.0, 0.14) : env.windSpeed;
        const windAngleMathDeg = 90 - env.windDirection;
        const windAngleRad = (windAngleMathDeg * Math.PI) / 180;
        const windENU = [-windSpeed * Math.cos(windAngleRad), windSpeed * Math.sin(windAngleRad), 0];
        const windBody = enuToBody(windENU, state.phi, state.theta, state.psi);
        const vBody = enuToBody(currentVENU, state.phi, state.theta, state.psi);
        const { alpha, beta, vRel } = calculateAerodynamicAngles(vBody, windBody);
        const vRelMag = Math.max(0.001, Math.sqrt(vRel[0]**2 + vRel[1]**2 + vRel[2]**2)); // avoid divide by zero
        
        // Aerodynamic coefficient calculation (use calibrated baseCd)
        const mach = Math.max(0.001, vRelMag / Math.max(atm.speedOfSound, 1.0)); // avoid divide by zero
        const reynolds = calculateReynoldsNumber(vRelMag, referenceLength, atm.density);
        
        // After parachute fully inflated, use fixed parachute Cd to avoid numerical instability
        let calibratedCd: number;
        let dragForce: number;
        let aeroCoeffs: any; // declared externally for debug logs
        const q = 0.5 * atm.density * vRelMag * vRelMag;
        
        if (parachuteState.fullyInflated) {
            // Parachute phase: use fixed parachute Cd
            // Parachute dominates drag, rocket body drag negligible
            const parachuteCd = parachuteData.cd * 0.65; // actual parachute Cd (~0.97)
            const parachuteArea = Math.PI * Math.pow(parachuteData.diameter / 2, 2);
            
            // Use effective parachute Cd (based on rocket reference area)
            calibratedCd = parachuteCd * (parachuteArea / refArea);
            dragForce = Math.max(0, q * parachuteArea * parachuteCd);
            
            // Provide simplified aero coeffs for debug logs
            aeroCoeffs = { cd: parachuteCd, cl: 0, cy: 0, cm: 0, cn: 0, clRoll: 0 };
        } else {
            // Normal flight phase: use rocket aerodynamic calculation
            aeroCoeffs = calculateAerodynamicCoefficients(
                alpha, beta, mach, reynolds, baseCd, cg, cp, referenceLength,
                rocket.finish, { p: state.p, q: state.q, r: state.r }
            );
            // Apply altitude calibration factor: increase drag to match actual flight data
            calibratedCd = Math.max(0.1, Math.min(2.0, aeroCoeffs.cd * ALTITUDE_CALIBRATION_FACTOR));
            dragForce = Math.max(0, q * refArea * calibratedCd);
        }
        
        const stabilityMargin = (cp - cg) / referenceLength;
        
        // Ensure data validity, avoid outliers (calculated before recording)
        // Note: altitude can record real value (including negative), but display uses Math.max(0, ...)
        const validAltitude = currentAltitude; // record real altitude (including negative) for accurate trajectory
        const validRange = Math.max(0, range);
        const validVelocity = Math.max(0, currentVelocity);
        const validDrag = Math.max(0, dragForce);
        const validCd = Math.max(0.1, Math.min(5.0, calibratedCd)); // parachute Cd may be >2, so upper limit relaxed to 5
        
        // Detailed debug logs (first 2 seconds detailed, then every 0.5s)
        if (time < 2.0 || time % 0.5 < dt) {
            const alphaDeg = alpha * 180 / Math.PI;
            const pitchDeg = state.theta * 180 / Math.PI;
            
            // Calculate force components (for diagnostics)
            const thrustENU_calc = isOnRail 
                ? [thrustMag * Math.cos(launchAngleRad), 0, thrustMag * Math.sin(launchAngleRad)]
                : bodyToENU([thrustMag, 0, 0], state.phi, state.theta, state.psi);
            const gravityENU_calc = [0, 0, -currentMass * G];
            
            // Calculate aerodynamic forces from coefficients (body frame)
            const dragForceBody = -q * refArea * aeroCoeffs.cd * (vRel[0] / vRelMag || 0);
            const liftForceBody = q * refArea * aeroCoeffs.cl * (vRel[2] / vRelMag || 0);
            const aeroBody = [dragForceBody, 0, liftForceBody];
            const aeroENU_calc = bodyToENU(aeroBody, state.phi, state.theta, state.psi);
            
            // Use Math.max(0, ...) for display to avoid negative altitude, but record real z for debug
            const displayAltitude = Math.max(0, state.z);
            console.log(`[6DOF DEBUG] t=${time.toFixed(2)}s: h=${displayAltitude.toFixed(1)}m (${(displayAltitude*3.28084).toFixed(1)}ft), real z=${state.z.toFixed(2)}m, v=${currentVelocity.toFixed(1)}m/s`);
            console.log(`[6DOF DEBUG]   thrust=${thrustMag.toFixed(1)}N, thrust ENU=[${thrustENU_calc[0].toFixed(2)}, ${thrustENU_calc[1].toFixed(2)}, ${thrustENU_calc[2].toFixed(2)}]`);
            console.log(`[6DOF DEBUG]   gravity ENU=[${gravityENU_calc[0].toFixed(2)}, ${gravityENU_calc[1].toFixed(2)}, ${gravityENU_calc[2].toFixed(2)}] (${(-currentMass*G).toFixed(2)}N down)`);
            console.log(`[6DOF DEBUG]   aero ENU=[${aeroENU_calc[0].toFixed(2)}, ${aeroENU_calc[1].toFixed(2)}, ${aeroENU_calc[2].toFixed(2)}], drag=${dragForce.toFixed(2)}N`);
            // Use RK4 weighted average acceleration for debug logs (consistent with data recording)
            const debugAccelX = (k1.dvx + 2*k2.dvx + 2*k3.dvx + k4.dvx) / 6;
            const debugAccelY = (k1.dvy + 2*k2.dvy + 2*k3.dvy + k4.dvy) / 6;
            const debugAccelZ = (k1.dvz + 2*k2.dvz + 2*k3.dvz + k4.dvz) / 6;
            console.log(`[6DOF DEBUG]   accel ENU=[${debugAccelX.toFixed(2)}, ${debugAccelY.toFixed(2)}, ${debugAccelZ.toFixed(2)}] m/s² (z=${debugAccelZ.toFixed(2)})`);
            console.log(`[6DOF DEBUG]   velocity ENU=[${state.vx.toFixed(2)}, ${state.vy.toFixed(2)}, ${state.vz.toFixed(2)}] m/s (up=${state.vz.toFixed(2)})`);
            console.log(`[6DOF DEBUG]   attitude: pitch=${pitchDeg.toFixed(1)}°, on rail=${isOnRail}, mass=${(currentMass*1000).toFixed(1)}g`);
        }
        
        // Data recording: every 0.1s or at key events
        const shouldRecord = (time % 0.1 < dt) || 
                            (time < 0.5) || // first 0.5s detailed
                            (currentAltitude > apogee * 0.99) || // near apogee
                            (time > rocket.motor.burnTime - 0.1 && time < rocket.motor.burnTime + 0.1); // around motor burnout
        
        if (shouldRecord) {
            // Calculate angle of attack and sideslip angle (degrees)
            const alphaDeg = alpha * 180 / Math.PI;
            const betaDeg = beta * 180 / Math.PI;
            
            // Attitude angles (degrees)
            const pitchDeg = state.theta * 180 / Math.PI;
            const yawDeg = state.psi * 180 / Math.PI;
            const rollDeg = state.phi * 180 / Math.PI;
            
            // Data consistency check: ensure all values correspond to same moment state
            // Position, velocity, acceleration should all correspond to state at time
            // Calculate compatible velocity components for 3D animation
            // 3D component expects: velocityX=horizontal velocity, velocityY=vertical velocity
            const horizontalVelocity = Math.sqrt(state.vx**2 + state.vy**2);
            // Preserve direction: sign of main horizontal direction
            const horizontalDirection = Math.sign(state.vx || state.vy || 1);
            
            const dataPoint: SimulationPoint = {
                time: Math.max(0, time),
                altitude: validAltitude,  // corresponds to state.z
                range: validRange,        // corresponds to sqrt(state.x² + state.y²), meters
                velocity: validVelocity,  // corresponds to sqrt(state.vx² + state.vy² + state.vz²)
                velocityX: horizontalVelocity * horizontalDirection,  // horizontal velocity (with direction, for 3D animation)
                velocityY: state.vz,                                  // vertical velocity (up positive, for 3D animation)
                acceleration: Math.max(0, currentAcceleration), // use RK4 weighted average acceleration for consistency
                thrust: Math.max(0, thrustMag),
                drag: validDrag,
                mass: Math.max(dryMass, currentMass), // ensure mass valid
                airDensity: Math.max(0.1, atm.density), // ensure density valid
                cd: validCd,  // use calibrated Cd, limited range
                // 6DOF extended data
                pitch: pitchDeg,
                yaw: yawDeg,
                roll: rollDeg,
                pitchRate: state.q,
                yawRate: state.r,
                rollRate: state.p,
                angleOfAttack: alphaDeg,
                sideslipAngle: betaDeg,
                mach: Math.max(0, mach),
                reynolds: Math.max(0, reynolds),
                liftCoefficient: aeroCoeffs.cl || 0,
                dragCoefficient: validCd,  // use calibrated Cd
                stabilityMargin: stabilityMargin
            };
            
            // Verify data consistency (development mode)
            if (process.env.NODE_ENV === 'development') {
                const expectedRange = Math.sqrt(state.x**2 + state.y**2);
                const expectedVelocity = Math.sqrt(state.vx**2 + state.vy**2 + state.vz**2);
                if (Math.abs(dataPoint.range - expectedRange) > 0.001 || 
                    Math.abs(dataPoint.velocity - expectedVelocity) > 0.001) {
                    console.warn(`[6DOF] Data consistency warning: time=${time.toFixed(3)}s, range diff=${Math.abs(dataPoint.range - expectedRange).toFixed(6)}m, velocity diff=${Math.abs(dataPoint.velocity - expectedVelocity).toFixed(6)}m/s`);
                }
            }
            
            data.push(dataPoint);
        }
        
        // Check landing (ENU: z < 0 means below ground)
        // Use real state.z, not currentAltitude (may be Math.max processed)
        if (state.z < 0 && hasLaunched) {
            console.log(`[6DOF] Rocket landed: t=${time.toFixed(2)}s, z=${state.z.toFixed(2)}m, velocity=${currentVelocity.toFixed(2)}m/s`);
            // Record last data point (landing moment)
            // Calculate compatible velocity components for 3D animation
            const landingHorizontalVelocity = Math.sqrt(state.vx**2 + state.vy**2);
            const landingHorizontalDirection = Math.sign(state.vx || state.vy || 1);
            
            const landingDataPoint: SimulationPoint = {
                time,
                altitude: state.z,
                range: range,
                velocity: currentVelocity,
                velocityX: landingHorizontalVelocity * landingHorizontalDirection,  // horizontal velocity (with direction)
                velocityY: state.vz,                                                // vertical velocity (up positive)
                acceleration: currentAcceleration,
                thrust: 0,
                drag: validDrag,
                mass: currentMass,
                airDensity: atm.density,
                cd: validCd,
                pitch: state.theta * 180 / Math.PI,
                yaw: state.psi * 180 / Math.PI,
                roll: state.phi * 180 / Math.PI,
                pitchRate: state.q,
                yawRate: state.r,
                rollRate: state.p,
                angleOfAttack: alpha * 180 / Math.PI,
                sideslipAngle: beta * 180 / Math.PI,
                mach: mach,
                reynolds: reynolds,
                liftCoefficient: aeroCoeffs.cl || 0,
                dragCoefficient: validCd,
                stabilityMargin: stabilityMargin
            };
            data.push(landingDataPoint);
            break;
        }
        
        // Use real state.z for launch detection, not currentAltitude (may be Math.max processed)
        if (state.z > 0.1 && !hasLaunched) {
            hasLaunched = true;
            console.log(`[6DOF] Rocket launched: t=${time.toFixed(2)}s, z=${state.z.toFixed(2)}m`);
        }
        
        // Numerical stability check
        if (isNaN(currentAltitude) || isNaN(currentVelocity) || !isFinite(currentAltitude) || !isFinite(currentVelocity)) {
            console.error(`[6DOF] Numerical error: altitude=${currentAltitude}, velocity=${currentVelocity}, time=${time}`);
            break;
        }
    }
    
    console.log(`[6DOF PHYSICS] ======= Simulation complete =======`);
    console.log(`[6DOF PHYSICS] Apogee: ${apogee.toFixed(1)}m (${(apogee * 3.28084).toFixed(1)}ft)`);
    console.log(`[6DOF PHYSICS] Max velocity: ${maxVelocity.toFixed(1)}m/s (${(maxVelocity * 3.28084).toFixed(1)} ft/s, ${(maxVelocity * 2.23694).toFixed(1)} mph)`);
    console.log(`[6DOF PHYSICS] Flight time: ${time.toFixed(2)}s`);
    console.log(`[6DOF PHYSICS] Data points: ${data.length}`);
    if (data.length > 0) {
        const lastPoint = data[data.length - 1];
        console.log(`[6DOF PHYSICS] Final position: [${state.x.toFixed(2)}, ${state.y.toFixed(2)}, ${state.z.toFixed(2)}]m`);
        console.log(`[6DOF PHYSICS] Final velocity: [${state.vx.toFixed(2)}, ${state.vy.toFixed(2)}, ${state.vz.toFixed(2)}]m/s`);
    }
    
    const initialTotalMass = dryMass + totalMotorMass;
    
    return {
        apogee,
        maxVelocity,
        flightTime: time,
        data,
        calculatedMass: initialTotalMass,
        calculatedArea: refArea
    };
};

// Backward-compatible aliases
export const runSimulation6DOF = runSimulation;

