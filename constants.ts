import { MotorData, RocketConfig, Environment, RocketComponent, Stage } from "./types";

export const G = 9.81; // m/s^2

export const MOTORS: Record<string, MotorData> = {
  'F15': {
    name: 'Estes F15-4',
    manufacturer: 'Estes',
    diameter: 0.024,
    length: 0.07,
    totalImpulse: 50,
    averageThrust: 14.7,
    maxThrust: 25,
    burnTime: 3.4,
    propellantMass: 0.030,
    totalMass: 0.100,
    thrustCurve: [
      { time: 0, thrust: 0 },
      { time: 0.2, thrust: 25 },
      { time: 0.5, thrust: 15 },
      { time: 1.5, thrust: 15 },
      { time: 3.0, thrust: 14 },
      { time: 3.4, thrust: 0 }
    ]
  },
  'E12': {
    name: 'Estes E12-6',
    manufacturer: 'Estes',
    diameter: 0.024,
    length: 0.07,
    totalImpulse: 27,
    averageThrust: 11.25,
    maxThrust: 25,
    burnTime: 2.4,
    propellantMass: 0.022,
    totalMass: 0.060,
    thrustCurve: [
      { time: 0, thrust: 0 },
      { time: 0.2, thrust: 25 },
      { time: 1.0, thrust: 10 },
      { time: 2.4, thrust: 0 }
    ]
  },
  'F67': {
    name: 'Aerotech F67',
    manufacturer: 'AeroTech',
    diameter: 0.029,
    length: 0.095,
    totalImpulse: 80,
    averageThrust: 66.7,
    maxThrust: 80,
    burnTime: 1.2,
    propellantMass: 0.040,
    totalMass: 0.120,
    thrustCurve: [
      { time: 0, thrust: 0 },
      { time: 0.1, thrust: 60 },
      { time: 0.3, thrust: 80 },
      { time: 1.0, thrust: 40 },
      { time: 1.2, thrust: 0 }
    ]
  },
  'F42T': {
    name: 'Cesaroni F42T',
    manufacturer: 'Cesaroni',
    diameter: 0.029,
    length: 0.095,
    totalImpulse: 73,
    averageThrust: 42.0,
    maxThrust: 50,
    burnTime: 1.7,
    propellantMass: 0.040,
    totalMass: 0.080,
    thrustCurve: [
      { time: 0, thrust: 0 },
      { time: 0.1, thrust: 45 },
      { time: 0.3, thrust: 50 },
      { time: 1.0, thrust: 40 },
      { time: 1.5, thrust: 30 },
      { time: 1.7, thrust: 0 }
    ]
  }
};

const DEFAULT_STAGE: Stage = {
  id: 'stage-1',
  type: 'STAGE',
  name: 'Sustainer',
  mass: 0,
  color: '#ffffff',
  position: 0,
  subComponents: [
    {
      id: 'nc-1',
      type: 'NOSECONE',
      name: 'Ogive Nose Cone',
      length: 0.18,
      baseDiameter: 0.042,
      mass: 0.025,
      shape: 'OGIVE',
      parameter: 1,
      wallThickness: 0.002,
      material: 'Plastic',
      color: '#E2E8F0',
      position: 0,
      subComponents: []
    },
    {
      id: 'bt-1',
      type: 'BODYTUBE',
      name: 'Upper Body Tube',
      length: 0.30,
      diameter: 0.042,
      innerDiameter: 0.040,
      mass: 0.040,
      isMotorMount: false,
      wallThickness: 0.001,
      material: 'Cardboard',
      color: '#F8FAFC',
      position: 0.18,
      subComponents: []
    },
    {
      id: 'tr-1',
      type: 'TRANSITION',
      name: 'Shoulder Transition',
      length: 0.05,
      foreDiameter: 0.042,
      aftDiameter: 0.042,
      shape: 'CONICAL',
      material: 'Plastic',
      mass: 0.005,
      color: '#3B82F6',
      position: 0.48,
      subComponents: []
    },
    {
      id: 'bt-2',
      type: 'BODYTUBE',
      name: 'Lower Body Tube',
      length: 0.25,
      diameter: 0.042,
      innerDiameter: 0.040,
      mass: 0.035,
      isMotorMount: true,
      wallThickness: 0.001,
      material: 'Cardboard',
      color: '#F8FAFC',
      position: 0.53,
      subComponents: [
        {
          id: 'fn-1',
          type: 'FINS',
          name: 'Trapezoidal Fins',
          mass: 0.015,
          finCount: 3,
          rootChord: 0.10,
          tipChord: 0.06,
          height: 0.05,
          sweep: 0.04,
          thickness: 0.003,
          crossSection: 'ROUNDED',
          rotation: 0,
          material: 'Plywood',
          color: '#3B82F6',
          position: 0.15, // Relative to parent BT
          subComponents: []
        }
      ]
    }
  ]
};

// Correcting the object literal structure
const SUSTAINER_STAGE: Stage = {
  id: 'stage-1',
  type: 'STAGE',
  name: 'Sustainer',
  mass: 0,
  color: '#ffffff',
  position: 0,
  subComponents: [
    {
      id: 'nc-1',
      type: 'NOSECONE',
      name: 'Ogive Nose Cone',
      length: 0.18,
      baseDiameter: 0.042,
      mass: 0.025,
      shape: 'OGIVE',
      parameter: 1,
      wallThickness: 0.002,
      material: 'Plastic',
      color: '#E2E8F0',
      position: 0,
      subComponents: []
    },
    {
      id: 'bt-1',
      type: 'BODYTUBE',
      name: 'Upper Body Tube',
      length: 0.30,
      diameter: 0.042,
      innerDiameter: 0.040,
      mass: 0.040,
      isMotorMount: false,
      wallThickness: 0.001,
      material: 'Cardboard',
      color: '#F8FAFC',
      position: 0.18,
      subComponents: []
    },
    {
      id: 'tr-1',
      type: 'TRANSITION',
      name: 'Shoulder Transition',
      length: 0.05,
      foreDiameter: 0.042,
      aftDiameter: 0.042,
      shape: 'CONICAL',
      material: 'Plastic',
      mass: 0.005,
      color: '#3B82F6',
      position: 0.48,
      subComponents: []
    },
    {
      id: 'bt-2',
      type: 'BODYTUBE',
      name: 'Lower Body Tube',
      length: 0.25,
      diameter: 0.042,
      innerDiameter: 0.040,
      mass: 0.035,
      isMotorMount: true,
      wallThickness: 0.001,
      material: 'Cardboard',
      color: '#F8FAFC',
      position: 0.53,
      subComponents: [
        {
          id: 'fn-1',
          type: 'FINS',
          name: 'Trapezoidal Fins',
          mass: 0.015,
          finCount: 3,
          rootChord: 0.10,
          tipChord: 0.06,
          height: 0.05,
          sweep: 0.04,
          thickness: 0.003,
          crossSection: 'ROUNDED',
          rotation: 0,
          material: 'Plywood',
          color: '#3B82F6',
          position: 0.15, // Relative to parent BT
          subComponents: []
        }
      ]
    }
  ]
};

export const DEFAULT_ROCKET: RocketConfig = {
  name: "ARC Competition Rocket v1",
  stages: [SUSTAINER_STAGE],
  motor: MOTORS['F42T'],
  cdOverride: 0.55,
};

// Default environment based on actual flight data (748ft flight: 11/20/2025)
// Temperature: 53.4°F = 11.9°C, Pressure: 30.16 inHg = 1021.3 hPa, Wind: 0 m/s
export const DEFAULT_ENV: Environment = {
  temperature: 12,        // Based on 748ft flight data (11.9°C, rounded to 12°C)
  pressure: 1021,          // Based on 748ft flight data (1021.3 hPa, rounded)
  humidity: 49,            // Based on 748ft flight data (49.1%, rounded)
  windSpeed: 0,            // Based on 748ft flight data (0 mph = 0 m/s)
  windDirection: 22.5,     // NNE direction (22.5° from North)
  airDensity: 1.225        // Will be calculated by atmosphere model
};

export const calculateAirDensity = (tempC: number, pressureHpa: number, humidity: number): number => {
  const T = tempC + 273.15;
  const P = pressureHpa * 100; // Pa
  const R_dry = 287.058;
  const R_vapor = 461.495;

  const es = 6.1078 * Math.pow(10, (7.5 * tempC) / (tempC + 237.3));
  const pv = (humidity / 100) * es * 100;
  const pd = P - pv;

  const rho = (pd / (R_dry * T)) + (pv / (R_vapor * T));
  return parseFloat(rho.toFixed(3));
};
