/**
 * Flight data calibration database
 * For storing real flight data, supports multi-point calibration
 */

export interface FlightDataPoint {
  id: string;                    // Unique identifier
  motor: string;                 // Motor model (e.g. "F42T", "F39")
  dryMass: number;               // Dry mass (kg)
  totalMass?: number;            // Total mass (incl. motor) (kg)
  windSpeed: number;             // Wind speed (m/s)
  windDirection: number;        // Wind direction (deg, 0=North, 90=East)
  measuredApogee: number;       // Measured apogee (m)
  measuredMaxVelocity?: number;  // Measured max velocity (m/s)
  measuredFlightTime?: number;   // Measured flight time (s)
  launchAngle?: number;         // Launch angle (deg, default 90)
  railLength?: number;          // Rail length (m)
  temperature?: number;         // Ambient temperature (°C)
  humidity?: number;            // Humidity (%)
  pressure?: number;            // Atmospheric pressure (hPa)
  notes?: string;               // Notes
  date?: string;                // Flight date
}

/**
 * Calibration database
 * Users can add their own flight data here
 */
export const CALIBRATION_DATABASE: FlightDataPoint[] = [
  {
    id: 'f42t-001',
    motor: 'F42T',
    dryMass: 0.532,              // 532g
    windSpeed: 1.0,
    windDirection: 0,
    measuredApogee: 228.0,       // 748 ft
    notes: 'Initial calibration data - F42T @ 1m/s wind',
    date: '2024-01-01'
  },
  // Users can add more data points here
  // Example:
  // {
  //   id: 'f39-001',
  //   motor: 'F39',
  //   dryMass: 0.515,
  //   windSpeed: 0.5,
  //   windDirection: 0,
  //   measuredApogee: 350.0,
  //   notes: 'F39 motor test'
  // }
];

/**
 * Find data points by motor model
 */
export const findDataPointsByMotor = (motorName: string): FlightDataPoint[] => {
  // Normalize motor name (remove delay, variant, etc.)
  const normalizedMotor = motorName.toUpperCase().match(/F-?\d+/)?.[0]?.replace('-', '') || '';
  
  return CALIBRATION_DATABASE.filter(point => {
    const pointMotor = point.motor.toUpperCase().match(/F-?\d+/)?.[0]?.replace('-', '') || '';
    return pointMotor === normalizedMotor || point.motor.toUpperCase().includes(normalizedMotor);
  });
};

/**
 * Find data point by ID
 */
export const findDataPointById = (id: string): FlightDataPoint | undefined => {
  return CALIBRATION_DATABASE.find(point => point.id === id);
};

/**
 * Add new data point (runtime only, not persisted)
 */
export const addDataPoint = (point: FlightDataPoint): void => {
  // Check if ID already exists
  if (findDataPointById(point.id)) {
    console.warn(`⚠️ Data point ${point.id} already exists, will be overwritten`);
  }
  
  // Add to database
  const index = CALIBRATION_DATABASE.findIndex(p => p.id === point.id);
  if (index >= 0) {
    CALIBRATION_DATABASE[index] = point;
  } else {
    CALIBRATION_DATABASE.push(point);
  }
  
  console.log(`✅ Added calibration data point: ${point.id} (${point.motor} @ ${point.measuredApogee.toFixed(1)}m)`);
};

/**
 * Get all data points
 */
export const getAllDataPoints = (): FlightDataPoint[] => {
  return [...CALIBRATION_DATABASE];
};

/**
 * Get database statistics
 */
export const getDatabaseStats = () => {
  const motors = new Set(CALIBRATION_DATABASE.map(p => p.motor));
  return {
    totalPoints: CALIBRATION_DATABASE.length,
    uniqueMotors: Array.from(motors),
    motorsCount: motors.size
  };
};





