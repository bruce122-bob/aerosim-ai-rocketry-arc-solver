/**
 * Batch Calibration Script
 * Runs calibration on all flight records and generates optimized parameters
 */

import { RocketConfig, Environment } from './types';
import { runSimulation, DEFAULT_PHYSICS_CONFIG, PhysicsConfig } from './services/physics6dof';
import { findMotorByDesignation } from './services/motorMatcher';
import * as fs from 'fs';
import * as path from 'path';

interface FlightRecord {
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

// Load flight data
const flightData: FlightRecord[] = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'flight_data.json'), 'utf-8')
);

// Convert wind direction to degrees
const windDirectionToDegrees = (direction: string): number => {
    const dirMap: Record<string, number> = {
        'N': 0, 'NNE': 22.5, 'NE': 45, 'ENE': 67.5,
        'E': 90, 'ESE': 112.5, 'SE': 135, 'SSE': 157.5,
        'S': 180, 'SSW': 202.5, 'SW': 225, 'WSW': 247.5,
        'W': 270, 'WNW': 292.5, 'NW': 315, 'NNW': 337.5
    };
    return dirMap[direction?.toUpperCase() || 'N'] || 0;
};

// Convert flight record to environment
const recordToEnvironment = (record: FlightRecord): Environment => {
    return {
        windSpeed: (record.wind_speed_mph || 0) * 0.44704, // mph to m/s
        windDirection: windDirectionToDegrees(record.wind_direction || 'N'),
        temperature: record.temp_c || ((record.temp_f || 20) - 32) * 5 / 9,
        pressure: record.pressure_hpa || (record.pressure_inhg || 29.92) * 33.8639,
        humidity: record.humidity_percent || 50,
        airDensity: undefined
    };
};

// Simple calibration: find k_drag that matches apogee
const calibrateSingleFlight = (
    rocket: RocketConfig,
    env: Environment,
    targetApogeeFt: number,
    massG: number,
    motorDesignation?: string
): { kThrust: number; kDrag: number; error: number } => {
    // Find the correct motor if designation provided
    const matchedMotor = motorDesignation ? findMotorByDesignation(motorDesignation) : null;
    
    // Modify rocket mass and motor
    const modifiedRocket: RocketConfig = {
        ...rocket,
        motor: matchedMotor || rocket.motor, // Use matched motor or fallback to default
        manualOverride: {
            ...rocket.manualOverride,
            mass: massG / 1000 // Convert g to kg
        }
    };

    // Binary search for k_drag
    let kDragLow = 0.9;
    let kDragHigh = 1.3;
    let bestKDrag = 1.12;
    let bestError = Infinity;
    let bestKThrust = 1.0;

    // Try different k_drag values
    for (let kDrag = kDragLow; kDrag <= kDragHigh; kDrag += 0.01) {
        const config: PhysicsConfig = {
            ...DEFAULT_PHYSICS_CONFIG,
            k_thrust: 1.0,
            k_drag: kDrag
        };

        const result = runSimulation(modifiedRocket, env, 90, 1.0, config);
        const simulatedApogeeFt = result.apogee * 3.28084;
        const error = Math.abs(simulatedApogeeFt - targetApogeeFt);

        if (error < bestError) {
            bestError = error;
            bestKDrag = kDrag;
        }
    }

    return {
        kThrust: bestKThrust,
        kDrag: bestKDrag,
        error: bestError
    };
};

// Run batch calibration
const runBatchCalibration = (rocket: RocketConfig) => {
    console.log('='.repeat(80));
    console.log('BATCH CALIBRATION - Using All Flight Records');
    console.log('='.repeat(80));
    console.log(`Total records: ${flightData.length}\n`);

    const results: Array<{
        record: FlightRecord;
        env: Environment;
        calibration: { kThrust: number; kDrag: number; error: number };
        simulatedApogee: number;
        actualApogee: number;
    }> = [];

    for (const record of flightData) {
        const env = recordToEnvironment(record);
        const calibration = calibrateSingleFlight(rocket, env, record.apogee_ft, record.mass_g, record.motor);

        // Find the correct motor from flight record
        const matchedMotor = findMotorByDesignation(record.motor);
        
        // Run simulation with calibrated parameters
        const modifiedRocket: RocketConfig = {
            ...rocket,
            motor: matchedMotor || rocket.motor, // Use matched motor or fallback to default
            manualOverride: {
                ...rocket.manualOverride,
                mass: record.mass_g / 1000
            }
        };

        const config: PhysicsConfig = {
            ...DEFAULT_PHYSICS_CONFIG,
            k_thrust: calibration.kThrust,
            k_drag: calibration.kDrag
        };

        const simResult = runSimulation(modifiedRocket, env, 90, 1.0, config);
        const simulatedApogee = simResult.apogee * 3.28084;

        results.push({
            record,
            env,
            calibration,
            simulatedApogee,
            actualApogee: record.apogee_ft
        });

        console.log(`Record ${results.length}: ${record.motor} - Mass=${record.mass_g}g, Temp=${record.temp_c?.toFixed(1)}°C`);
        console.log(`  Actual: ${record.apogee_ft}ft, Simulated: ${simulatedApogee.toFixed(1)}ft, Error: ${calibration.error.toFixed(1)}ft`);
        console.log(`  Calibrated: k_thrust=${calibration.kThrust.toFixed(3)}, k_drag=${calibration.kDrag.toFixed(3)}\n`);
    }

    // Calculate statistics
    const kThrustValues = results.map(r => r.calibration.kThrust);
    const kDragValues = results.map(r => r.calibration.kDrag);
    const errors = results.map(r => r.calibration.error);

    const avgKThrust = kThrustValues.reduce((a, b) => a + b, 0) / kThrustValues.length;
    const avgKDrag = kDragValues.reduce((a, b) => a + b, 0) / kDragValues.length;
    const meanError = errors.reduce((a, b) => a + b, 0) / errors.length;
    const maxError = Math.max(...errors);
    const minError = Math.min(...errors);

    const variance = errors.reduce((sum, err) => sum + Math.pow(err - meanError, 2), 0) / errors.length;
    const stdDevError = Math.sqrt(variance);

    console.log('='.repeat(80));
    console.log('CALIBRATION RESULTS');
    console.log('='.repeat(80));
    console.log(`Average k_thrust: ${avgKThrust.toFixed(3)}`);
    console.log(`Average k_drag: ${avgKDrag.toFixed(3)}`);
    console.log(`Mean error: ${meanError.toFixed(1)} ft`);
    console.log(`Std dev error: ${stdDevError.toFixed(1)} ft`);
    console.log(`Error range: ${minError.toFixed(1)} - ${maxError.toFixed(1)} ft`);

    // Save results
    const output = {
        timestamp: new Date().toISOString(),
        calibration: {
            kThrust: avgKThrust,
            kDrag: avgKDrag
        },
        statistics: {
            meanError,
            stdDevError,
            maxError,
            minError
        },
        individualResults: results
    };

    fs.writeFileSync(
        path.join(__dirname, 'calibration_results.json'),
        JSON.stringify(output, null, 2)
    );

    console.log('\nResults saved to: calibration_results.json');
    return output;
};

// This would be called from a Node.js script
// For now, we'll create a browser-based version instead

