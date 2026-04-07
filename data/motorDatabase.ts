import { MotorData } from '../types';

// ============================================
// BrookX ARC 2026 Motor Database
// Only motors used by BrookX ARC teams
// ============================================
export const MOTOR_DATABASE: MotorData[] = [

  // AeroTech F32-6T
  // Used by: 67 Masons (launches 11-15, Mar 2026)
  // Motor mass: 64g
  // Source: NAR certified RASP file via thrustcurve.org (cert ID: 5f4294d20002e90000000543)
  // Certified: January 11, 2009. Propellant: Blue Thunder. Case: RMS-24/60.
  {
    name: 'AeroTech F32-6T',
    manufacturer: 'AeroTech',
    diameter: 0.024,
    length: 0.090,
    totalImpulse: 56.9,
    averageThrust: 34.1,
    maxThrust: 58.4,
    burnTime: 2.064,
    delayTime: 6.0,
    thrustCurve: [
      { time: 0.000, thrust: 0.00 },
      { time: 0.170, thrust: 0.24 },
      { time: 0.192, thrust: 0.79 },
      { time: 0.202, thrust: 2.69 },
      { time: 0.204, thrust: 3.57 },
      { time: 0.208, thrust: 7.97 },
      { time: 0.210, thrust: 11.79 },
      { time: 0.212, thrust: 16.83 },
      { time: 0.220, thrust: 39.23 },
      { time: 0.224, thrust: 46.78 },
      { time: 0.228, thrust: 51.90 },
      { time: 0.232, thrust: 55.30 },
      { time: 0.236, thrust: 56.96 },
      { time: 0.258, thrust: 58.40 },
      { time: 0.288, thrust: 55.24 },
      { time: 0.316, thrust: 53.47 },
      { time: 0.394, thrust: 49.59 },
      { time: 0.458, thrust: 47.40 },
      { time: 0.730, thrust: 41.22 },
      { time: 0.904, thrust: 39.38 },
      { time: 1.110, thrust: 35.67 },
      { time: 1.198, thrust: 35.09 },
      { time: 1.220, thrust: 33.83 },
      { time: 1.260, thrust: 33.50 },
      { time: 1.478, thrust: 27.38 },
      { time: 1.490, thrust: 27.75 },
      { time: 1.510, thrust: 25.44 },
      { time: 1.676, thrust: 11.27 },
      { time: 1.768, thrust: 5.95 },
      { time: 1.852, thrust: 2.91 },
      { time: 1.952, thrust: 0.75 },
      { time: 2.064, thrust: 0.00 },
    ],
    propellantMass: 0.0258,
    totalMass: 0.064
  },

  // AeroTech F39-6T
  // Used by: Westerlies (launches 3,5-12), Emma Julia Team (launches 3,4,6-11)
  // Motor mass: 59g
  // Source: NAR certified RASP file via thrustcurve.org (cert ID: 5f4294d20002e90000000287)
  // Certified: February 23, 2017. Propellant: Blue Thunder. Case: RMS-24/40.
  // NOTE: 24mm motor (NOT 29mm). Available delays: 3, 6, 9 seconds.
  {
    name: 'AeroTech F39-6T',
    manufacturer: 'AeroTech',
    diameter: 0.024,
    length: 0.070,
    totalImpulse: 49.7,
    averageThrust: 37.3,
    maxThrust: 59.47,
    burnTime: 1.330,
    delayTime: 6.0,
    thrustCurve: [
      { time: 0.000, thrust: 0.00 },
      { time: 0.010, thrust: 45.06 },
      { time: 0.016, thrust: 54.13 },
      { time: 0.046, thrust: 58.32 },
      { time: 0.079, thrust: 59.47 },
      { time: 0.103, thrust: 58.31 },
      { time: 0.130, thrust: 57.25 },
      { time: 0.172, thrust: 55.49 },
      { time: 0.235, thrust: 53.74 },
      { time: 0.321, thrust: 51.27 },
      { time: 0.363, thrust: 50.57 },
      { time: 0.387, thrust: 49.51 },
      { time: 0.408, thrust: 50.20 },
      { time: 0.426, thrust: 48.80 },
      { time: 0.453, thrust: 47.75 },
      { time: 0.480, thrust: 47.04 },
      { time: 0.680, thrust: 41.06 },
      { time: 0.716, thrust: 39.65 },
      { time: 0.752, thrust: 38.94 },
      { time: 0.809, thrust: 36.49 },
      { time: 0.860, thrust: 34.38 },
      { time: 0.893, thrust: 33.32 },
      { time: 0.917, thrust: 32.62 },
      { time: 1.000, thrust: 28.75 },
      { time: 1.075, thrust: 25.25 },
      { time: 1.105, thrust: 22.10 },
      { time: 1.126, thrust: 17.20 },
      { time: 1.144, thrust: 13.00 },
      { time: 1.174, thrust: 8.11 },
      { time: 1.219, thrust: 4.61 },
      { time: 1.261, thrust: 2.50 },
      { time: 1.330, thrust: 0.00 },
    ],
    propellantMass: 0.0227,
    totalMass: 0.059
  },

  // AeroTech F42-8T
  // Used by: Westerlies (launches 1,2,4), Mile Team (most launches), Emma Julia Team (launches 10-19)
  // Motor mass: 75.9g
  {
    name: 'AeroTech F42-8T',
    manufacturer: 'AeroTech',
    diameter: 0.029,
    length: 0.083,
    totalImpulse: 52.9,
    averageThrust: 42,
    maxThrust: 68,
    burnTime: 1.26,
    delayTime: 8.0,
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
    totalMass: 0.0759
  },

  // AeroTech F51-6T
  // Used by: 67 Masons (launches 3-10), Emma Julia Team (launches 1,2,5,7), Lisa/Eileen Team (all), Yeri Team (launches 4,5)
  // Motor mass: 81g
  {
    name: 'AeroTech F51-6T',
    manufacturer: 'AeroTech',
    diameter: 0.029,
    length: 0.095,
    totalImpulse: 55.1,
    averageThrust: 51,
    maxThrust: 85,
    burnTime: 1.08,
    delayTime: 6.0,
    thrustCurve: [
      { time: 0.00, thrust: 0.0 },
      { time: 0.05, thrust: 80.0 },
      { time: 0.15, thrust: 85.0 },
      { time: 0.35, thrust: 70.0 },
      { time: 0.65, thrust: 55.0 },
      { time: 0.90, thrust: 40.0 },
      { time: 1.05, thrust: 20.0 },
      { time: 1.08, thrust: 0.0 }
    ],
    propellantMass: 0.0265,
    totalMass: 0.081
  },

  // AeroTech F51-9T
  // Used by: Mile Team (launch 6, Dec 13 2025)
  // Motor mass: ~81g (same motor body, different delay)
  {
    name: 'AeroTech F51-9T',
    manufacturer: 'AeroTech',
    diameter: 0.029,
    length: 0.095,
    totalImpulse: 55.1,
    averageThrust: 51,
    maxThrust: 85,
    burnTime: 1.08,
    delayTime: 9.0,
    thrustCurve: [
      { time: 0.00, thrust: 0.0 },
      { time: 0.05, thrust: 80.0 },
      { time: 0.15, thrust: 85.0 },
      { time: 0.35, thrust: 70.0 },
      { time: 0.65, thrust: 55.0 },
      { time: 0.90, thrust: 40.0 },
      { time: 1.05, thrust: 20.0 },
      { time: 1.08, thrust: 0.0 }
    ],
    propellantMass: 0.0265,
    totalMass: 0.081
  },

  // AeroTech F63R (RMS-24/60 Reloadable)
  // Used by: 725 ARC team (.ork import compatibility)
  // Motor mass: 82g (total loaded), propellant: 28g
  // Source: thrustcurve.org
  {
    name: 'AeroTech F63R-6',
    manufacturer: 'AeroTech',
    diameter: 0.024,
    length: 0.095,
    totalImpulse: 49.5,
    averageThrust: 58.1,
    maxThrust: 69.9,
    burnTime: 0.85,
    delayTime: 6.0,
    thrustCurve: [
      { time: 0.00,  thrust: 0.0 },
      { time: 0.01,  thrust: 21.25 },
      { time: 0.10,  thrust: 62.0 },
      { time: 0.20,  thrust: 67.0 },
      { time: 0.30,  thrust: 69.0 },
      { time: 0.32,  thrust: 69.9 },
      { time: 0.40,  thrust: 69.0 },
      { time: 0.50,  thrust: 65.0 },
      { time: 0.60,  thrust: 60.0 },
      { time: 0.70,  thrust: 57.0 },
      { time: 0.76,  thrust: 56.0 },
      { time: 0.80,  thrust: 28.0 },
      { time: 0.83,  thrust: 8.0 },
      { time: 0.85,  thrust: 0.0 }
    ],
    propellantMass: 0.028,
    totalMass: 0.082
  },
];

// Motor manufacturers
export const MOTOR_MANUFACTURERS = ['All', 'AeroTech'];

// Motor classes
export const MOTOR_CLASSES = ['All', 'F'];

// Helper function to filter motors
export const filterMotors = (
  motors: MotorData[],
  manufacturer: string,
  motorClass: string,
  searchQuery: string
): MotorData[] => {
  return motors.filter(motor => {
    // Filter by manufacturer
    if (manufacturer !== 'All' && !motor.name.includes(manufacturer)) {
      return false;
    }

    // Filter by motor class
    if (motorClass !== 'All') {
      const regex = new RegExp(`\\b${motorClass}\\d`, 'i');
      if (!regex.test(motor.name)) {
        return false;
      }
    }

    // Filter by search query
    if (searchQuery && !motor.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }

    return true;
  });
};
