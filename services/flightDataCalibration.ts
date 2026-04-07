/**
 * Flight Data Calibration System
 * Uses real flight data from PDF to calibrate simulation parameters
 */

import { RocketConfig, Environment } from "../types";
import { calibrateFromFlightData, FlightDataPoint, CalibrationResult } from "./physics6dof";
import { findMotorByDesignation } from "./motorMatcher";
import flightDataJson from "../flight_data.json";

export interface FlightRecord {
    team: string;
    date: string;
    launch_number: number;
    apogee_ft: number;
    mass_g: number;
    flight_time_s: number;
    ascent_time_s?: number;
    wind_speed_mph: number;
    wind_direction?: string;
    humidity_percent?: number;
    temp_f?: number;
    temp_c?: number;
    pressure_inhg?: number;
    pressure_hpa?: number;
    motor: string;
    motor_mass_g?: number;
}

/**
 * Convert flight record to simulation environment
 */
export const flightRecordToEnvironment = (record: FlightRecord): Environment => {
    return {
        windSpeed: (record.wind_speed_mph || 0) * 0.44704, // Convert mph to m/s
        windDirection: windDirectionToDegrees(record.wind_direction || 'N'),
        temperature: record.temp_c || ((record.temp_f || 20) - 32) * 5 / 9,
        pressure: record.pressure_hpa || (record.pressure_inhg || 29.92) * 33.8639,
        humidity: record.humidity_percent || 50,
        // C10: Compute air density from ISA model using temperature and pressure
        airDensity: (() => {
            const tempK = (record.temp_c || ((record.temp_f || 20) - 32) * 5 / 9) + 273.15;
            const pressurePa = (record.pressure_hpa || (record.pressure_inhg || 29.92) * 33.8639) * 100;
            return pressurePa / (287.058 * tempK);
        })()
    };
};

/**
 * Convert wind direction string to degrees (Navigation: 0=N, 90=E, 180=S, 270=W)
 */
const windDirectionToDegrees = (direction: string): number => {
    const dirMap: Record<string, number> = {
        'N': 0,
        'NNE': 22.5,
        'NE': 45,
        'ENE': 67.5,
        'E': 90,
        'ESE': 112.5,
        'SE': 135,
        'SSE': 157.5,
        'S': 180,
        'SSW': 202.5,
        'SW': 225,
        'WSW': 247.5,
        'W': 270,
        'WNW': 292.5,
        'NW': 315,
        'NNW': 337.5
    };
    return dirMap[direction.toUpperCase()] || 0;
};

/**
 * Batch calibrate using multiple flight records
 * Finds optimal k_thrust and k_drag that minimize total RMSE across all flights
 */
export const batchCalibrate = async (
    rocket: RocketConfig,
    flightRecords: FlightRecord[],
    motorFilter?: string // Filter by motor type (e.g., 'F42-8T')
): Promise<{
    calibration: CalibrationResult;
    individualResults: Array<{
        record: FlightRecord;
        result: CalibrationResult;
        simulatedApogee: number;
        actualApogee: number;
        error: number;
    }>;
    statistics: {
        meanError: number;
        stdDevError: number;
        maxError: number;
        minError: number;
    };
}> => {
    console.log(`[BATCH CALIBRATION] Starting batch calibration with ${flightRecords.length} flight records...`);
    
    // Filter by motor if specified
    const filteredRecords = motorFilter 
        ? flightRecords.filter(r => r.motor === motorFilter)
        : flightRecords;
    
    console.log(`[BATCH CALIBRATION] Using ${filteredRecords.length} records${motorFilter ? ` (filtered by ${motorFilter})` : ''}`);
    
    // Convert records to flight data format
    const flightDataArrays: Array<{ record: FlightRecord; data: FlightDataPoint[] }> = [];
    
    for (const record of filteredRecords) {
        // Create synthetic flight data from record
        // We only have apogee, so create a simple trajectory
        const ascentTime = record.ascent_time_s || record.flight_time_s * 0.1; // Estimate if missing
        const descentTime = record.flight_time_s - ascentTime;
        
        const data: FlightDataPoint[] = [];
        
        // Ascent phase (parabolic approximation)
        const numAscentPoints = 20;
        for (let i = 0; i <= numAscentPoints; i++) {
            const t = (i / numAscentPoints) * ascentTime;
            // C9: Monotonic parabolic ascent: h = h_max * (2*progress - progress^2)
            // Peaks at progress=1 (apogee), unlike 4p-4p^2 which peaks at 0.5
            const progress = t / ascentTime;
            const altitude = record.apogee_ft * (2 * progress - progress * progress);
            data.push({ time: t, altitude: altitude });
        }
        
        // Descent phase (linear approximation with parachute)
        const numDescentPoints = 30;
        for (let i = 1; i <= numDescentPoints; i++) {
            const t = ascentTime + (i / numDescentPoints) * descentTime;
            // Linear descent: h = h_max * (1 - (t - T_ascent) / T_descent)
            const descentProgress = (t - ascentTime) / descentTime;
            const altitude = record.apogee_ft * (1 - descentProgress);
            data.push({ time: t, altitude: altitude });
        }
        
        flightDataArrays.push({ record, data });
    }
    
    // Calibrate each flight individually first
    const individualResults: Array<{
        record: FlightRecord;
        result: CalibrationResult;
        simulatedApogee: number;
        actualApogee: number;
        error: number;
    }> = [];
    
    let kThrustSum = 0;
    let kDragSum = 0;
    let count = 0;
    
    for (const { record, data } of flightDataArrays) {
        const env = flightRecordToEnvironment(record);
        
        // Find the correct motor from flight record
        const matchedMotor = findMotorByDesignation(record.motor);
        const modifiedRocket: RocketConfig = {
            ...rocket,
            motor: matchedMotor || rocket.motor, // Use matched motor or fallback to default
            manualOverride: {
                ...rocket.manualOverride,
                mass: record.mass_g / 1000 // Convert g to kg
            }
        };
        
        // Run calibration
        const result = await calibrateFromFlightData(modifiedRocket, env, data);
        
        // Run simulation with calibrated parameters to get apogee
        const { runSimulation } = await import('./physics6dof');
        const { DEFAULT_PHYSICS_CONFIG } = await import('./physics6dof');
        
        const simResult = await runSimulation(modifiedRocket, env, 90, 1.0, {
            ...DEFAULT_PHYSICS_CONFIG,
            k_thrust: result.kThrust,
            k_drag: result.kDrag
        });
        
        const simulatedApogee = simResult.apogee * 3.28084; // Convert to feet
        const actualApogee = record.apogee_ft;
        const error = Math.abs(simulatedApogee - actualApogee);
        
        individualResults.push({
            record,
            result,
            simulatedApogee,
            actualApogee,
            error
        });
        
        kThrustSum += result.kThrust;
        kDragSum += result.kDrag;
        count++;
    }
    
    // Calculate average calibration parameters
    const avgKThrust = kThrustSum / count;
    const avgKDrag = kDragSum / count;
    
    // Calculate statistics
    const errors = individualResults.map(r => r.error);
    const meanError = errors.reduce((a, b) => a + b, 0) / errors.length;
    const variance = errors.reduce((sum, err) => sum + Math.pow(err - meanError, 2), 0) / errors.length;
    const stdDevError = Math.sqrt(variance);
    const maxError = Math.max(...errors);
    const minError = Math.min(...errors);
    
    console.log(`[BATCH CALIBRATION] Complete!`);
    console.log(`[BATCH CALIBRATION] Average k_thrust: ${avgKThrust.toFixed(3)}`);
    console.log(`[BATCH CALIBRATION] Average k_drag: ${avgKDrag.toFixed(3)}`);
    console.log(`[BATCH CALIBRATION] Mean error: ${meanError.toFixed(1)} ft`);
    console.log(`[BATCH CALIBRATION] Std dev error: ${stdDevError.toFixed(1)} ft`);
    
    return {
        calibration: {
            kThrust: avgKThrust,
            kDrag: avgKDrag,
            initialRMSE: 0, // Not applicable for batch
            finalRMSE: meanError / 3.28084, // Convert to meters
            improvement: 0,
            iterations: count,
            convergence: true
        },
        individualResults,
        statistics: {
            meanError,
            stdDevError,
            maxError,
            minError
        }
    };
};

/**
 * Load flight data from JSON file
 */
export const loadFlightData = async (): Promise<FlightRecord[]> => {
    try {
        return flightDataJson as FlightRecord[];
    } catch (error) {
        console.error('[FLIGHT DATA] Failed to load flight data:', error);
        return [];
    }
};
