export enum ViewMode {
  EDITOR = 'EDITOR',
  SIMULATION = 'SIMULATION',
  ANALYSIS = 'ANALYSIS'
}

export type ComponentType =
  | 'STAGE'
  | 'NOSECONE'
  | 'BODYTUBE'
  | 'TRANSITION'
  | 'FINS'
  | 'INNER_TUBE'
  | 'CENTERING_RING'
  | 'PARACHUTE'
  | 'SHOCK_CORD'
  | 'ENGINE_BLOCK'
  | 'MASS_COMPONENT'
  | 'LAUNCH_LUG';

export interface BaseComponent {
  id: string;
  type: ComponentType;
  name: string;
  mass: number; // kg
  overridesSubComponents?: boolean;
  color: string;
  position: number; // Relative position from parent top (m)
  relativeTo?: 'top' | 'bottom' | 'middle' | 'absolute'; // Position reference point
  subComponents: RocketComponent[];
}

export interface Stage extends BaseComponent {
  type: 'STAGE';
}

export interface NoseCone extends BaseComponent {
  type: 'NOSECONE';
  length: number; // m
  baseDiameter: number; // m
  shape: 'OGIVE' | 'CONICAL' | 'ELLIPSOID' | 'POWER_SERIES';
  parameter: number; // For shapes like power series (0-1)
  wallThickness: number; // m
  material: string;
}

export interface BodyTube extends BaseComponent {
  type: 'BODYTUBE';
  length: number; // m
  diameter: number; // m (Outer diameter)
  innerDiameter: number; // m
  isMotorMount: boolean;
  motorMountDiameter?: number; // m (if simple mount)
  wallThickness: number; // m
  material: string;
}

export interface InnerTube extends BaseComponent {
  type: 'INNER_TUBE';
  length: number; // m
  outerDiameter: number; // m
  innerDiameter: number; // m
  material: string;
}

export interface CenteringRing extends BaseComponent {
  type: 'CENTERING_RING';
  outerDiameter: number; // m
  innerDiameter: number; // m
  thickness: number; // m
  material: string;
}

export interface Transition extends BaseComponent {
  type: 'TRANSITION';
  length: number; // m
  foreDiameter: number; // m
  aftDiameter: number; // m
  shape: 'CONICAL' | 'OGIVE';
  material: string;
}

export interface FinSet extends BaseComponent {
  type: 'FINS';
  finCount: number;
  rootChord: number; // m
  tipChord: number; // m
  height: number; // m (span)
  sweep: number; // m
  thickness: number; // m
  crossSection: 'SQUARE' | 'ROUNDED' | 'AIRFOIL';
  rotation: number; // degrees (rotation around tube)
  material: string;
}

export interface Parachute extends BaseComponent {
  type: 'PARACHUTE';
  diameter: number; // m
  cd: number; // Drag coefficient of the chute
  packedLength: number; // m
  packedDiameter: number; // m
  lineLength: number; // m
}

export interface ShockCord extends BaseComponent {
  type: 'SHOCK_CORD';
  length: number; // m
  material: string;
}

export interface EngineBlock extends BaseComponent {
  type: 'ENGINE_BLOCK';
  outerDiameter: number; // m
  innerDiameter: number; // m
  thickness: number; // m
}

export interface MassComponent extends BaseComponent {
  type: 'MASS_COMPONENT';
  length: number;
  diameter: number;
}

export interface LaunchLug extends BaseComponent {
  type: 'LAUNCH_LUG';
  length: number;
  innerDiameter: number;
  outerDiameter: number;
}

export type RocketComponent =
  | Stage
  | NoseCone
  | BodyTube
  | InnerTube
  | CenteringRing
  | Transition
  | FinSet
  | Parachute
  | ShockCord
  | EngineBlock
  | MassComponent
  | LaunchLug;

export interface MotorData {
  name: string;
  manufacturer?: string;
  diameter?: number; // m
  length?: number; // m
  totalImpulse: number; // Ns
  averageThrust?: number; // N
  maxThrust?: number; // N
  burnTime: number; // s
  thrustCurve: { time: number; thrust: number }[]; // Time (s), Thrust (N)
  propellantMass: number; // kg
  totalMass: number; // kg
  delayTime?: number; // s - Delay from burn end to ejection charge (for reloadable motors)
}

export type WindProfileMode = 'constant' | 'layered';
export type WindInterpolationMode = 'linear';
export type SurfaceRoughness = 'water' | 'open' | 'suburban' | 'urban';

export interface WindLayer {
  altitude: number; // m AGL
  speed: number; // m/s
  direction: number; // degrees, FROM direction
  turbulenceIntensity?: number; // 0-1 local turbulence gain
}

export interface WindGustSettings {
  enabled: boolean;
  intensity: number; // 0-1 relative gust amplitude
  frequency: number; // nondimensional time scale multiplier
  directionalVarianceDeg: number; // peak direction wobble
  seed?: number; // deterministic seed for repeatable runs
}

export interface WindProfile {
  mode: WindProfileMode;
  interpolation: WindInterpolationMode;
  referenceHeight: number; // m
  hellmannExponent: number; // terrain-dependent shear exponent
  surfaceRoughness: SurfaceRoughness;
  layers: WindLayer[];
  gusts?: WindGustSettings;
}

export interface Environment {
  temperature: number; // Celsius
  pressure: number; // hPa
  humidity: number; // %
  windSpeed: number; // m/s
  windDirection: number; // degrees
  airDensity: number; // kg/m^3 (calculated)
  windProfile?: WindProfile;
}

export interface RocketConfig {
  name: string;
  stages: Stage[];
  motor: MotorData;
  cdOverride: number;
  // Additional physical parameters extracted from file
  finish?: string; // surface roughness
  stability?: {
    cg?: number; // preset center of gravity (if available)
    cp?: number; // preset center of pressure (if available)
    margin?: number;
  };
  simulationSettings?: {
    launchRodLength?: number; // launch rod length
    windSpeed?: number;       // preset wind speed
    timeStep?: number;        // simulation step size
    cg?: number; // CG read from file (m)
    cp?: number; // CP read from file (m)
    mass?: number; // total mass read from file (kg)
    referenceLength?: number; // OpenRocket reference length (m)
    referenceType?: string; // OpenRocket reference type (maximum, nosecone, etc.)
    kThrust?: number;  // thrust calibration coefficient (default 1.0)
    kDrag?: number;    // drag calibration coefficient (default 1.0)
  };
  manualOverride?: {
    cg?: number; // user manually calibrated CG (m)
    cp?: number; // user manually calibrated CP (m)
    mass?: number; // user manually calibrated mass (kg)
    diameter?: number; // user manually calibrated max diameter (m)
    cdOverride?: number; // user manually calibrated drag coefficient Cd
  };
}

export interface SimulationPoint {
  time: number;
  altitude: number;
  range: number; // Horizontal distance
  velocity: number;
  velocityX: number;
  velocityY: number;
  acceleration: number;
  thrust: number;
  drag: number;
  mass: number;
  airDensity: number; // Log density at this altitude
  cd: number; // Log used Cd
  relativeAirspeed?: number; // speed relative to moving air mass (m/s)
  dynamicPressure?: number; // Pa
  windSpeedAtAltitude?: number; // m/s
  windVelocityX?: number; // m/s
  windVelocityY?: number; // m/s
  windDirectionAtAltitude?: number; // degrees, FROM direction
  parachuteDeployed?: boolean;
  // 6DOF extended data
  pitch?: number;        // pitch angle (deg)
  yaw?: number;           // yaw angle (deg)
  roll?: number;          // roll angle (deg)
  pitchRate?: number;     // pitch rate (rad/s)
  yawRate?: number;       // yaw rate (rad/s)
  rollRate?: number;      // roll rate (rad/s)
  angleOfAttack?: number; // angle of attack (deg)
  sideslipAngle?: number; // sideslip angle (deg)
  mach?: number;          // Mach number
  reynolds?: number;      // Reynolds number
  liftCoefficient?: number; // lift coefficient
  dragCoefficient?: number; // drag coefficient
  stabilityMargin?: number; // stability margin (cal)
}

export interface SimulationResult {
  apogee: number; // m
  maxVelocity: number; // m/s
  flightTime: number; // s
  data: SimulationPoint[];
  calculatedMass: number; // kg
  calculatedArea: number; // m^2
}

export interface AnalysisResult {
  estimatedCd: number;
  confidence: string;
  recommendations: string[];
}
