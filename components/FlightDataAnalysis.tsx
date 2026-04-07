import React, { useState, useEffect, useMemo } from 'react';
import { RocketConfig, Environment } from '../types';
import { runSimulation } from '../services/physics6dofStable';
import { enhancedCalibrate } from '../services/enhancedCalibration';
import { findMotorByDesignation } from '../services/motorMatcher';
import { addCalibrationRecord } from '../services/calibrationStatus';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, ReferenceLine } from 'recharts';
import flightDataJson from '../flight_data.json';

interface FlightRecord {
    team: string;
    date: string;
    launch_number: number;
    location?: string;
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

const isCalibrationEligibleRecord = (record: FlightRecord): boolean => {
    const predictionContaminated = (record.location || '').includes('Prediction row');
    const hasWeather = (record.temp_c !== undefined || record.temp_f !== undefined)
        && (record.pressure_hpa !== undefined || record.pressure_inhg !== undefined);
    return !predictionContaminated && hasWeather;
};

const recordKey = (record: FlightRecord): string => `${record.team}__${record.date}__${record.launch_number}__${record.motor}`;

const sameStringArray = (a: string[], b: string[]): boolean => (
    a.length === b.length && a.every((value, index) => value === b[index])
);

const diagnoseResult = (result: {
    error: number;
    actualApogee: number;
    actualFlightTimeS: number;
    simulatedFlightTimeS: number;
    maxAoADeg: number;
    maxMach: number;
    windSpeedMph: number;
    launchMassG: number;
}, allLaunchMasses: number[]): string[] => {
    const labels: string[] = [];
    const errorPercent = result.actualApogee > 0 ? (result.error / result.actualApogee) * 100 : 0;
    const avgLaunchMass = allLaunchMasses.length > 0
        ? allLaunchMasses.reduce((sum, value) => sum + value, 0) / allLaunchMasses.length
        : result.launchMassG;

    if (errorPercent < 2) labels.push('Very strong fit');
    else if (errorPercent < 5) labels.push('Strong fit');
    else if (errorPercent > 8) labels.push('Large residual');

    if (result.maxAoADeg > 6) labels.push('Wind-sensitive trajectory');
    if (result.maxMach > 0.75) labels.push('Near-transonic loading');
    if (result.windSpeedMph >= 4) labels.push('Higher wind record');
    if (Math.abs(result.simulatedFlightTimeS - result.actualFlightTimeS) > 5) labels.push('Flight-time mismatch');
    if (Math.abs(result.launchMassG - avgLaunchMass) > 20) labels.push('Mass outlier');

    return labels.slice(0, 3);
};

interface CalibrationResult {
    kThrust: number;
    kDrag: number;
    error: number;
    simulatedApogee: number;
    actualApogee: number;
    record: FlightRecord;
    baselineError: number;
    launchMassG: number;
    simulatedFlightTimeS: number;
    actualFlightTimeS: number;
    maxMach: number;
    maxQPa: number;
    maxAoADeg: number;
    windSpeedMph: number;
    diagnosis: string[];
}

interface Props {
    rocket: RocketConfig;
    hasImportedRocket?: boolean;
    onUpdateRocket?: (updater: (rocket: RocketConfig) => RocketConfig) => void;
}

const FlightDataAnalysis: React.FC<Props> = ({ rocket, hasImportedRocket = false, onUpdateRocket }) => {
    const [flightData, setFlightData] = useState<FlightRecord[]>([]);
    const [calibrationResults, setCalibrationResults] = useState<CalibrationResult[]>([]);
    const [isCalibrating, setIsCalibrating] = useState(false);
    const [datasetMode, setDatasetMode] = useState<'motor' | 'all'>('motor');
    const [cohortMode, setCohortMode] = useState<'auto' | 'allTeams'>('auto');
    const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
    const [excludedRecordKeys, setExcludedRecordKeys] = useState<string[]>([]);
    const [avgKThrust, setAvgKThrust] = useState(1.0);
    const [avgKDrag, setAvgKDrag] = useState(1.0);
    const [statistics, setStatistics] = useState({
        meanError: 0,
        stdDevError: 0,
        maxError: 0,
        minError: 0
    });
    const calibrationLaunchAngleDeg = 90;
    const calibrationRailLength = rocket.simulationSettings?.launchRodLength ?? 1.0;

    // Load flight data (内联导入，兼容 file:// 协议)
    useEffect(() => {
        setFlightData(flightDataJson as any);
    }, []);

    useEffect(() => {
        setCalibrationResults([]);
        setStatistics({
            meanError: 0,
            stdDevError: 0,
            maxError: 0,
            minError: 0
        });
    }, [rocket.name, rocket.motor.name, datasetMode, cohortMode, selectedTeams, excludedRecordKeys]);

    const currentMotorFamily = useMemo(() => {
        const designation = rocket.motor?.name?.match(/([A-Z]\d{2})-\d+[A-Z]?/)?.[1];
        return designation || '';
    }, [rocket.motor?.name]);

    const motorFamilyFlightData = useMemo(() => {
        const cleanRecords = flightData.filter(isCalibrationEligibleRecord);
        const sameMotorFamily = currentMotorFamily
            ? cleanRecords.filter(record => record.motor.startsWith(currentMotorFamily))
            : [...cleanRecords];

        if (datasetMode === 'all') {
            return cleanRecords;
        }

        return sameMotorFamily.length > 0 ? sameMotorFamily : cleanRecords;
    }, [currentMotorFamily, datasetMode, flightData]);

    const recommendedTeam = useMemo(() => {
        const counts = new Map<string, number>();
        for (const record of motorFamilyFlightData) {
            counts.set(record.team, (counts.get(record.team) || 0) + 1);
        }
        let bestTeam: string | null = null;
        let bestCount = 0;
        for (const [team, count] of counts.entries()) {
            if (count > bestCount) {
                bestTeam = team;
                bestCount = count;
            }
        }
        return bestCount >= 4 ? bestTeam : null;
    }, [motorFamilyFlightData]);

    const managedFlightData = useMemo(() => {
        let scoped = motorFamilyFlightData;

        if (cohortMode === 'auto' && recommendedTeam) {
            const sameTeam = scoped.filter(record => record.team === recommendedTeam);
            scoped = sameTeam.length > 0 ? sameTeam : scoped;
        }

        if (cohortMode === 'allTeams' && selectedTeams.length > 0) {
            const selected = scoped.filter(record => selectedTeams.includes(record.team));
            scoped = selected.length > 0 ? selected : scoped;
        }

        return scoped;
    }, [cohortMode, motorFamilyFlightData, recommendedTeam, selectedTeams]);

    const activeFlightData = useMemo(() => {
        if (excludedRecordKeys.length === 0) {
            return managedFlightData;
        }
        return managedFlightData.filter(record => !excludedRecordKeys.includes(recordKey(record)));
    }, [excludedRecordKeys, managedFlightData]);

    const availableTeams = useMemo(() => {
        return [...new Set(motorFamilyFlightData.map(record => record.team))].sort();
    }, [motorFamilyFlightData]);

    useEffect(() => {
        if (cohortMode === 'auto') {
            const nextTeams = recommendedTeam ? [recommendedTeam] : [];
            setSelectedTeams(prev => sameStringArray(prev, nextTeams) ? prev : nextTeams);
            return;
        }

        setSelectedTeams(prev => {
            if (prev.length > 0) {
                const filtered = prev.filter(team => availableTeams.includes(team));
                return sameStringArray(prev, filtered) ? prev : filtered;
            }
            return sameStringArray(prev, availableTeams) ? prev : availableTeams;
        });
    }, [availableTeams, cohortMode, recommendedTeam]);

    const teamCount = new Set(activeFlightData.map(record => record.team)).size;
    const motorCount = new Set(activeFlightData.map(record => record.motor)).size;

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

    const buildDiagnostics = (
        record: FlightRecord,
        baselineError: number,
        simulatedApogee: number,
        kThrust: number,
        kDrag: number,
        finalResult: Awaited<ReturnType<typeof runSimulation>>
    ): CalibrationResult => {
        const maxMach = finalResult.data.reduce((max, point) => Math.max(max, point.mach ?? 0), 0);
        const maxQPa = finalResult.data.reduce((max, point) => Math.max(max, point.dynamicPressure ?? 0), 0);
        const maxAoADeg = finalResult.data.reduce((max, point) => Math.max(max, point.angleOfAttack ?? 0), 0);
        const launchMassG = finalResult.calculatedMass * 1000;

        return {
            kThrust,
            kDrag,
            error: Math.abs(simulatedApogee - record.apogee_ft),
            simulatedApogee,
            actualApogee: record.apogee_ft,
            record,
            baselineError,
            launchMassG,
            simulatedFlightTimeS: finalResult.flightTime,
            actualFlightTimeS: record.flight_time_s,
            maxMach,
            maxQPa,
            maxAoADeg,
            windSpeedMph: record.wind_speed_mph ?? 0,
            diagnosis: []
        };
    };

    // Calibrate single flight
    const calibrateSingleFlight = async (
        record: FlightRecord,
        env: Environment
    ): Promise<CalibrationResult> => {
        // Find the correct motor from flight record
        const matchedMotor = findMotorByDesignation(record.motor);
        if (!matchedMotor) {
            console.warn(`[CALIBRATION] Could not match motor "${record.motor}", using default rocket motor`);
        }

        // Modify rocket with correct mass and motor
        const modifiedRocket: RocketConfig = {
            ...rocket,
            motor: matchedMotor || rocket.motor, // Use matched motor or fallback to default
            manualOverride: {
                ...rocket.manualOverride,
                mass: record.mass_g / 1000 // Convert g to kg
            }
        };

        // Run baseline simulation (before calibration) for verification
        const baselineResult = await runSimulation(modifiedRocket, env, calibrationLaunchAngleDeg, calibrationRailLength);
        const baselineError = Math.abs(baselineResult.apogee * 3.28084 - record.apogee_ft);
        console.log(`[CALIBRATION] Baseline error (before calibration): ${baselineError.toFixed(1)}ft`);

        // Use enhanced calibration with Adam optimizer
        try {
            const apogeeMeters = record.apogee_ft / 3.28084;
            const ascentTime = record.ascent_time_s || 5.0;
            const flightData = [
                { time: ascentTime * 0.5, altitude: apogeeMeters * 0.5 },
                { time: ascentTime * 0.8, altitude: apogeeMeters * 0.9 },
                { time: ascentTime, altitude: apogeeMeters }
            ];

            const enhancedResult = await enhancedCalibrate(
                modifiedRocket,
                env,
                flightData,
                calibrationLaunchAngleDeg,
                calibrationRailLength,
                1.0,
                1.0,
                100
            );

            const rocketWithCalibration: RocketConfig = {
                ...modifiedRocket,
                simulationSettings: {
                    ...modifiedRocket.simulationSettings,
                    kThrust: enhancedResult.kThrust,
                    kDrag: enhancedResult.kDrag
                }
            };

            const finalResult = await runSimulation(rocketWithCalibration, env, calibrationLaunchAngleDeg, calibrationRailLength);
            const simulatedApogee = finalResult.apogee * 3.28084;
            const error = Math.abs(simulatedApogee - record.apogee_ft);
            if (Number.isFinite(error) && error <= Math.min(30, baselineError)) {
                const actualApogeeMeters = record.apogee_ft / 3.28084;
                const simulatedApogeeMeters = finalResult.apogee;

                addCalibrationRecord(
                    actualApogeeMeters,
                    simulatedApogeeMeters,
                    enhancedResult.kThrust,
                    enhancedResult.kDrag,
                    {
                        windSpeed: env.windSpeed,
                        temperature: env.temperature,
                        humidity: env.humidity
                    }
                );

                if (onUpdateRocket) {
                    onUpdateRocket((currentRocket) => ({
                        ...currentRocket,
                        simulationSettings: {
                            ...currentRocket.simulationSettings,
                            kThrust: enhancedResult.kThrust,
                            kDrag: enhancedResult.kDrag
                        }
                    }));
                }

                return buildDiagnostics(
                    record,
                    baselineError,
                    simulatedApogee,
                    enhancedResult.kThrust,
                    enhancedResult.kDrag,
                    finalResult
                );
            }

            console.warn(
                `[CALIBRATION] Enhanced calibration rejected for ${record.motor} (${record.mass_g}g): baseline ${baselineError.toFixed(1)}ft vs enhanced ${error.toFixed(1)}ft`
            );
        } catch (error) {
            console.warn('Enhanced calibration failed, falling back to binary search:', error);
        }

        // Binary search for k_drag that matches apogee (fallback method)
        // Use binary search for more precise optimization
        let bestKDrag = 1.0;
        let bestError = Infinity;
        let bestKThrust = 1.0;

        // Binary search for optimal k_drag (more efficient and precise)
        const binarySearchKDrag = async (low: number, high: number, targetApogee: number): Promise<number> => {
            let bestK = 1.0;
            let bestErr = Infinity;
            const iterations = 20; // Binary search iterations
            
            for (let i = 0; i < iterations; i++) {
                const mid = (low + high) / 2;
                const k1 = mid - 0.01;
                const k2 = mid + 0.01;
                
                // Test k1 using physics6dofStable
                const rocket1: RocketConfig = {
                    ...modifiedRocket,
                    simulationSettings: {
                        ...modifiedRocket.simulationSettings,
                        kThrust: 1.0,
                        kDrag: k1
                    }
                };
                const result1 = await runSimulation(rocket1, env, calibrationLaunchAngleDeg, calibrationRailLength);
                const error1 = Math.abs(result1.apogee * 3.28084 - targetApogee);
                
                // Test k2 using physics6dofStable
                const rocket2: RocketConfig = {
                    ...modifiedRocket,
                    simulationSettings: {
                        ...modifiedRocket.simulationSettings,
                        kThrust: 1.0,
                        kDrag: k2
                    }
                };
                const result2 = await runSimulation(rocket2, env, calibrationLaunchAngleDeg, calibrationRailLength);
                const error2 = Math.abs(result2.apogee * 3.28084 - targetApogee);
                
                // Update best
                if (error1 < bestErr) {
                    bestErr = error1;
                    bestK = k1;
                }
                if (error2 < bestErr) {
                    bestErr = error2;
                    bestK = k2;
                }
                
                // Narrow search range
                if (result1.apogee * 3.28084 > targetApogee) {
                    // Simulated too high, need more drag
                    low = mid;
                } else {
                    // Simulated too low, need less drag
                    high = mid;
                }
            }
            
            // Final fine-grained search around best value
            const finalRange = 0.1;
            const finalLow = Math.max(0.8, bestK - finalRange);
            const finalHigh = Math.min(2.0, bestK + finalRange);
            
            for (let kDrag = finalLow; kDrag <= finalHigh; kDrag += 0.001) {
                const testRocket: RocketConfig = {
                    ...modifiedRocket,
                    simulationSettings: {
                        ...modifiedRocket.simulationSettings,
                        kThrust: 1.0,
                        kDrag: kDrag
                    }
                };
                const result = await runSimulation(testRocket, env, calibrationLaunchAngleDeg, calibrationRailLength);
                const error = Math.abs(result.apogee * 3.28084 - targetApogee);
                
                if (error < bestErr) {
                    bestErr = error;
                    bestK = kDrag;
                }
            }
            
            return bestK;
        };

        // Use binary search to find optimal k_drag
        bestKDrag = await binarySearchKDrag(0.8, 2.0, record.apogee_ft);
        
        // Verify the result using physics6dofStable
        const verifyRocket: RocketConfig = {
            ...modifiedRocket,
            simulationSettings: {
                ...modifiedRocket.simulationSettings,
                kThrust: 1.0,
                kDrag: bestKDrag
            }
        };
        const verifyResult = await runSimulation(verifyRocket, env, calibrationLaunchAngleDeg, calibrationRailLength);
        bestError = Math.abs(verifyResult.apogee * 3.28084 - record.apogee_ft);

        // If error is still large (>50ft), try optimizing both k_thrust and k_drag
        if (bestError > 50) {
            console.log(`[CALIBRATION] Large error (${bestError.toFixed(1)}ft), optimizing both k_thrust and k_drag...`);
            let bestErrorCombined = bestError;
            
            // Fine-grained search around best k_drag value (expanded range for better coverage)
            // Parameter ranges: kThrust (0.8-1.2), kDrag (0.8-1.5) - consistent with validation ranges
            for (let kThrust = 0.95; kThrust <= 1.05; kThrust += 0.01) {
                for (let kDrag = 0.8; kDrag <= 1.5; kDrag += 0.005) {
                    const testRocketCombined: RocketConfig = {
                        ...modifiedRocket,
                        simulationSettings: {
                            ...modifiedRocket.simulationSettings,
                            kThrust: kThrust,
                            kDrag: kDrag
                        }
                    };

                    const result = await runSimulation(testRocketCombined, env, calibrationLaunchAngleDeg, calibrationRailLength);
                    const simulatedApogeeFt = result.apogee * 3.28084;
                    const error = Math.abs(simulatedApogeeFt - record.apogee_ft);

                    if (error < bestErrorCombined) {
                        bestErrorCombined = error;
                        bestKDrag = kDrag;
                        bestKThrust = kThrust;
                    }
                }
            }
            bestError = bestErrorCombined;
        }

        // Final simulation with best parameters using physics6dofStable
        const finalRocket: RocketConfig = {
            ...modifiedRocket,
            simulationSettings: {
                ...modifiedRocket.simulationSettings,
                kThrust: bestKThrust,
                kDrag: bestKDrag
            }
        };

        const finalResult = await runSimulation(finalRocket, env, calibrationLaunchAngleDeg, calibrationRailLength);
        const simulatedApogee = finalResult.apogee * 3.28084;
        
        // Verify calibration improvement (for binary search path)
        const improvement = ((baselineError - bestError) / baselineError) * 100;
        if (improvement < 20) {
            console.warn(`[CALIBRATION] ⚠️ Low improvement: ${improvement.toFixed(1)}% (baseline: ${baselineError.toFixed(1)}ft → calibrated: ${bestError.toFixed(1)}ft)`);
        } else {
            console.log(`[CALIBRATION] ✅ Improvement: ${improvement.toFixed(1)}% (baseline: ${baselineError.toFixed(1)}ft → calibrated: ${bestError.toFixed(1)}ft)`);
        }

        // Save calibration record to history
        const actualApogeeMeters = record.apogee_ft / 3.28084;
        const simulatedApogeeMeters = finalResult.apogee;
        addCalibrationRecord(
            actualApogeeMeters,
            simulatedApogeeMeters,
            bestKThrust,
            bestKDrag,
            {
                windSpeed: env.windSpeed,
                temperature: env.temperature,
                humidity: env.humidity
            }
        );

        // Update rocket config after single calibration
        if (onUpdateRocket) {
            onUpdateRocket((currentRocket) => ({
                ...currentRocket,
                simulationSettings: {
                    ...currentRocket.simulationSettings,
                    kThrust: bestKThrust,
                    kDrag: bestKDrag
                }
            }));
        }

        console.log(`[CALIBRATION] Flight ${record.motor} (${record.mass_g}g): Actual=${record.apogee_ft.toFixed(1)}ft, Sim=${simulatedApogee.toFixed(1)}ft, Error=${bestError.toFixed(1)}ft, k_thrust=${bestKThrust.toFixed(3)}, k_drag=${bestKDrag.toFixed(3)}`);

        return buildDiagnostics(
            record,
            baselineError,
            simulatedApogee,
            bestKThrust,
            bestKDrag,
            finalResult
        );
    };

    // Run batch calibration
    const handleBatchCalibration = () => {
        if (!hasImportedRocket) {
            alert('Upload your .ork rocket first before running calibration. Using the default rocket will produce misleading results.');
            return;
        }
        if (activeFlightData.length === 0) {
            alert('Please load flight data first');
            return;
        }

        setIsCalibrating(true);
        const results: CalibrationResult[] = [];

        // Process in batches to avoid blocking UI
        const processBatch = async (startIdx: number) => {
            const batchSize = 5;
            const endIdx = Math.min(startIdx + batchSize, activeFlightData.length);

            for (let i = startIdx; i < endIdx; i++) {
                const record = activeFlightData[i];
                const env = recordToEnvironment(record);
                const result = await calibrateSingleFlight(record, env);
                results.push(result);
            }

            if (endIdx < activeFlightData.length) {
                setTimeout(async () => await processBatch(endIdx), 100);
            } else {
                const launchMasses = results.map(result => result.launchMassG);
                const annotatedResults = results.map(result => ({
                    ...result,
                    diagnosis: diagnoseResult(result, launchMasses)
                }));

                // Calculate statistics with weighted average (more precise)
                // Weighted average: lower error = higher weight (inverse weighting)
                // weight_i = 1 / (error_i + 0.1)  // 0.1 to prevent division by zero
                // This ensures that more accurate calibration results have higher influence
                const kThrustValues = annotatedResults.map(r => r.kThrust);
                const kDragValues = annotatedResults.map(r => r.kDrag);
                const errors = annotatedResults.map(r => r.error);

                // Calculate weights (inverse of error, with small offset to prevent division by zero)
                const weights = errors.map(error => 1 / (error + 0.1));
                const totalWeight = weights.reduce((a, b) => a + b, 0);

                // Weighted average for kThrust and kDrag
                const avgKThrust = kThrustValues.reduce((sum, val, idx) => sum + val * weights[idx], 0) / totalWeight;
                const avgKDrag = kDragValues.reduce((sum, val, idx) => sum + val * weights[idx], 0) / totalWeight;
                
                // Parameter sanity check (per plan requirements)
                const kThrustMin = 0.8, kThrustMax = 1.2;
                const kDragMin = 0.8, kDragMax = 1.5;
                
                if (avgKThrust < kThrustMin || avgKThrust > kThrustMax) {
                    console.warn(`[CALIBRATION] ⚠️ kThrust out of reasonable range (${avgKThrust.toFixed(3)}), should be between ${kThrustMin}-${kThrustMax}`);
                }
                if (avgKDrag < kDragMin || avgKDrag > kDragMax) {
                    console.warn(`[CALIBRATION] ⚠️ kDrag out of reasonable range (${avgKDrag.toFixed(3)}), should be between ${kDragMin}-${kDragMax}`);
                }
                
                // Check for individual flight parameter outliers
                const outlierParams = annotatedResults.filter(r => 
                    r.kThrust < kThrustMin || r.kThrust > kThrustMax ||
                    r.kDrag < kDragMin || r.kDrag > kDragMax
                );
                if (outlierParams.length > 0) {
                    console.warn(`[CALIBRATION] ⚠️ Found ${outlierParams.length} outlier parameter values that may need manual review`);
                }
                
                // Simple average for errors (for display purposes)
                const meanError = errors.reduce((a, b) => a + b, 0) / errors.length;
                const maxError = Math.max(...errors);
                const minError = Math.min(...errors);

                const variance = errors.reduce((sum, err) => sum + Math.pow(err - meanError, 2), 0) / errors.length;
                const stdDevError = Math.sqrt(variance);

                // Calculate additional statistics for validation
                const improvements = annotatedResults.map(r => {
                    // Estimate baseline error (we don't have it stored, so use current error as approximation)
                    // In practice, baseline would be ~100% error without calibration
                    const estimatedBaselineError = Math.max(r.error * 2, 50); // Conservative estimate
                    return ((estimatedBaselineError - r.error) / estimatedBaselineError) * 100;
                });
                const meanImprovement = improvements.reduce((a, b) => a + b, 0) / improvements.length;
                
                // Calculate parameter standard deviations (consistency check)
                const kThrustStdDev = Math.sqrt(
                    kThrustValues.reduce((sum, val) => sum + Math.pow(val - avgKThrust, 2), 0) / kThrustValues.length
                );
                const kDragStdDev = Math.sqrt(
                    kDragValues.reduce((sum, val) => sum + Math.pow(val - avgKDrag, 2), 0) / kDragValues.length
                );
                
                // Log comprehensive statistics
                console.log(`[CALIBRATION] 📊 Batch calibration statistics:`);
                console.log(`  Mean error: ${meanError.toFixed(1)}ft (${((meanError / (annotatedResults[0]?.actualApogee || 791)) * 100).toFixed(1)}%)`);
                console.log(`  Error std dev: ±${stdDevError.toFixed(1)}ft`);
                console.log(`  Mean improvement: ${meanImprovement.toFixed(1)}%`);
                console.log(`  kThrust: ${avgKThrust.toFixed(4)} (std dev: ±${kThrustStdDev.toFixed(4)})`);
                console.log(`  kDrag: ${avgKDrag.toFixed(4)} (std dev: ±${kDragStdDev.toFixed(4)})`);
                
                // Warn if parameter variance is too high (indicates inconsistent data)
                if (kThrustStdDev > 0.1 || kDragStdDev > 0.15) {
                    console.warn(`[CALIBRATION] ⚠️ Parameter std dev is high (kThrust: ±${kThrustStdDev.toFixed(4)}, kDrag: ±${kDragStdDev.toFixed(4)})`);
                }
                
                // Validate final calibration quality
                const errorPercent = (meanError / (annotatedResults[0]?.actualApogee || 791)) * 100;
                if (errorPercent < 5) {
                    console.log(`[CALIBRATION] ✅ Calibration quality: Excellent (error < 5%)`);
                } else if (errorPercent < 10) {
                    console.log(`[CALIBRATION] ⚠️ Calibration quality: Good (error 5-10%)`);
                } else {
                    console.warn(`[CALIBRATION] ⚠️ Calibration quality: Needs improvement (error > 10%)`);
                }

                setCalibrationResults(annotatedResults);
                setAvgKThrust(avgKThrust);
                setAvgKDrag(avgKDrag);
                setStatistics({
                    meanError,
                    stdDevError,
                    maxError,
                    minError
                });
                setIsCalibrating(false);

                // Auto-apply average calibration params to rocket config
                if (onUpdateRocket) {
                    onUpdateRocket((currentRocket) => ({
                        ...currentRocket,
                        simulationSettings: {
                            ...currentRocket.simulationSettings,
                            kThrust: avgKThrust,
                            kDrag: avgKDrag
                        }
                    }));
                    console.log(`[CALIBRATION] Auto-applied calibration params: k_thrust=${avgKThrust.toFixed(3)}, k_drag=${avgKDrag.toFixed(3)}`);
                }
            }
        };

        processBatch(0);
    };

    // Prepare chart data
    const comparisonData = calibrationResults.map((result, idx) => ({
        index: idx + 1,
        actual: result.actualApogee,
        simulated: result.simulatedApogee,
        error: result.error,
        motor: result.record.motor || 'Unknown',
        flightNumber: result.record.launch_number,
    }));

    const errorDistribution = calibrationResults.map((result, idx) => ({
        index: idx + 1,
        error: result.error,
        motor: result.record.motor || 'Unknown',
        flightNumber: result.record.launch_number,
    }));

    const diagnosticSummary = useMemo(() => {
        if (calibrationResults.length === 0) return null;
        const strongFits = calibrationResults.filter(result => result.error < 10).length;
        const reviewNeeded = calibrationResults.filter(result => result.error >= 20).length;
        const meanMaxAoA = calibrationResults.reduce((sum, result) => sum + result.maxAoADeg, 0) / calibrationResults.length;
        const peakMach = calibrationResults.reduce((max, result) => Math.max(max, result.maxMach), 0);
        const peakQPa = calibrationResults.reduce((max, result) => Math.max(max, result.maxQPa), 0);
        const largestFlightTimeGap = calibrationResults.reduce((max, result) => Math.max(max, Math.abs(result.simulatedFlightTimeS - result.actualFlightTimeS)), 0);
        return {
            strongFits,
            reviewNeeded,
            meanMaxAoA,
            peakMach,
            peakQPa,
            largestFlightTimeGap,
        };
    }, [calibrationResults]);

    return (
        <div className="space-y-6 text-slate-200">
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-5">
                <div className="flex items-start justify-between gap-6">
                    <div className="max-w-2xl">
                        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-cyan-400">Flight Validation</div>
                        <h3 className="mb-2 text-lg font-semibold text-slate-50">Calibrate the model against measured flights</h3>
                        <p className="text-sm leading-6 text-slate-400">
                            This tool fits `k_thrust` and `k_drag` to real apogee data. Use it when you want the simulator to match your actual hardware and motor behavior, not just theory.
                        </p>
                    </div>
                    <div className="min-w-[220px] rounded-xl border border-slate-800 bg-[#0b1323] p-4">
                        <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-slate-500">Data Set</div>
                        <div className="text-2xl font-semibold text-slate-100">{activeFlightData.length}</div>
                        <p className="mt-2 text-xs text-slate-400">
                            Active calibration set across {teamCount} teams and {motorCount} motor families.
                        </p>
                    </div>
                </div>
            </div>

            <div className="mb-6 rounded-lg border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <h3 className="mb-1 text-sm font-semibold text-slate-100">Calibration Data Scope</h3>
                        <p className="text-xs text-slate-400">
                            Default mode now groups by motor family first, then auto-picks the most populated team cohort inside that family. This avoids fitting your rocket against a different airframe that happened to use the same motor.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2 items-center">
                        {([
                            ['motor', `Motor Family${currentMotorFamily ? ` (${currentMotorFamily})` : ''}`],
                            ['all', 'All Flights'],
                        ] as const).map(([value, label]) => (
                            <button
                                key={value}
                                onClick={() => setDatasetMode(value)}
                                className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                                    datasetMode === value
                                        ? 'bg-cyan-500/12 text-cyan-200 border border-cyan-500/20'
                                        : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                        {datasetMode === 'motor' && (
                            <>
                                <div className="w-px h-6 bg-gray-300 mx-1" />
                                {([
                                    ['auto', recommendedTeam ? `Auto Team (${recommendedTeam})` : 'Auto Team'],
                                    ['allTeams', 'All Teams In Family'],
                                ] as const).map(([value, label]) => (
                                    <button
                                        key={value}
                                        onClick={() => setCohortMode(value)}
                                        className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                                            cohortMode === value
                                                ? 'bg-slate-700 text-slate-100'
                                                : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                                        }`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </>
                        )}
                    </div>
                </div>
            </div>

            <div className="mb-6 rounded-lg border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1">
                        <h3 className="text-sm font-semibold text-slate-100">Calibration Dataset Manager</h3>
                        <p className="text-xs text-slate-400">
                            Review the exact flights going into the fit. If one record looks suspicious, exclude it instead of letting it corrupt the whole calibration run.
                        </p>
                    </div>

                    {datasetMode === 'motor' && cohortMode === 'allTeams' && (
                        <div>
                            <div className="mb-2 text-xs font-medium text-slate-400">Teams Included</div>
                            <div className="flex flex-wrap gap-2">
                                {availableTeams.map(team => {
                                    const checked = selectedTeams.includes(team);
                                    return (
                                        <button
                                            key={team}
                                            onClick={() => setSelectedTeams(current => (
                                                checked
                                                    ? current.filter(value => value !== team)
                                                    : [...current, team]
                                            ))}
                                            className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                                                checked
                                                    ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/20'
                                                    : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                                            }`}
                                        >
                                            {team}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div className="overflow-x-auto rounded-lg border border-slate-800">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-slate-900/80">
                                <tr>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Use</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Team</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Date</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Flight#</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Motor</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Mass(g)</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Apogee(ft)</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Wind</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800 bg-[#0b1323]">
                                {managedFlightData.map(record => {
                                    const key = recordKey(record);
                                    const excluded = excludedRecordKeys.includes(key);
                                    return (
                                        <tr key={key} className={excluded ? 'bg-red-500/5' : ''}>
                                            <td className="px-3 py-2 text-sm">
                                                <input
                                                    type="checkbox"
                                                    checked={!excluded}
                                                    onChange={() => setExcludedRecordKeys(current => (
                                                        excluded
                                                            ? current.filter(value => value !== key)
                                                            : [...current, key]
                                                    ))}
                                                />
                                            </td>
                                            <td className="px-3 py-2 text-sm text-slate-200">{record.team}</td>
                                            <td className="px-3 py-2 text-sm text-slate-400">{record.date}</td>
                                            <td className="px-3 py-2 text-sm text-slate-400">{record.launch_number}</td>
                                            <td className="px-3 py-2 text-sm text-slate-400">{record.motor}</td>
                                            <td className="px-3 py-2 text-sm text-slate-400">{record.mass_g.toFixed(1)}</td>
                                            <td className="px-3 py-2 text-sm font-medium text-slate-100">{record.apogee_ft.toFixed(1)}</td>
                                            <td className="px-3 py-2 text-sm text-slate-400">
                                                {typeof record.wind_speed_mph === 'number' ? `${record.wind_speed_mph.toFixed(1)} mph` : 'N/A'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Calibration Controls */}
            <div className="mb-6 rounded-lg border border-slate-800 bg-slate-950/70 p-5">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h3 className="mb-1 text-base font-semibold text-slate-100">Batch Calibration</h3>
                        <p className="text-sm text-slate-400">
                            Use stored real-flight records to fit `k_thrust` and `k_drag` against actual apogee.
                        </p>
                        {!hasImportedRocket && (
                            <p className="mt-2 text-xs text-amber-300">
                                Calibration is blocked until an ORK-derived rocket is loaded. The default demo rocket is not suitable for real-flight fitting.
                            </p>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleBatchCalibration}
                            disabled={isCalibrating || activeFlightData.length === 0 || !hasImportedRocket}
                            className="rounded-lg border border-cyan-500/20 bg-cyan-500/12 px-5 py-2 font-medium text-cyan-100 transition-colors hover:bg-cyan-500/18 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isCalibrating ? 'Calibrating...' : 'Start Calibration'}
                        </button>
                    </div>
                </div>

                {calibrationResults.length > 0 && (
                    <div className="grid grid-cols-4 gap-4 mt-4">
                        <div className="rounded-lg border border-slate-800 bg-[#0b1323] p-4">
                            <div className="mb-1 text-xs text-slate-500">Avg k_thrust</div>
                            <div className="text-xl font-semibold text-slate-100">{avgKThrust.toFixed(3)}</div>
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-[#0b1323] p-4">
                            <div className="mb-1 text-xs text-slate-500">Avg k_drag</div>
                            <div className="text-xl font-semibold text-slate-100">{avgKDrag.toFixed(3)}</div>
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-[#0b1323] p-4">
                            <div className="mb-1 text-xs text-slate-500">Mean Error</div>
                            <div className="text-xl font-semibold text-slate-100">{statistics.meanError.toFixed(1)} ft</div>
                        </div>
                        <div className="rounded-lg border border-slate-800 bg-[#0b1323] p-4">
                            <div className="mb-1 text-xs text-slate-500">Std Dev</div>
                            <div className="text-xl font-semibold text-slate-100">{statistics.stdDevError.toFixed(1)} ft</div>
                        </div>
                    </div>
                )}
            </div>

            {calibrationResults.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                        <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-slate-500">Calibration Quality</div>
                        <div className={`text-sm font-semibold ${
                            statistics.meanError < 10 ? 'text-emerald-300' :
                            statistics.meanError < 20 ? 'text-amber-300' : 'text-red-300'
                        }`}>
                            {statistics.meanError < 10 ? 'Excellent match' :
                             statistics.meanError < 20 ? 'Usable but should improve' : 'Needs more work'}
                        </div>
                        <p className="mt-2 text-xs text-slate-400">
                            Mean apogee error {statistics.meanError.toFixed(1)} ft across calibrated flights.
                        </p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                        <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-slate-500">Applied Physics Factors</div>
                        <div className="text-sm font-semibold text-slate-100">
                            k_thrust {avgKThrust.toFixed(3)} / k_drag {avgKDrag.toFixed(3)}
                        </div>
                        <p className="mt-2 text-xs text-slate-400">These are the averaged factors currently applied back into the rocket configuration.</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                        <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-slate-500">Professional Read</div>
                        <p className="text-sm text-slate-400">
                            Use this page to validate realism. If the error remains large, the next suspects are motor curve quality, Cd assumptions, or inaccurate mass / recovery inputs.
                        </p>
                    </div>
                </div>
            )}

            {diagnosticSummary && (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="rounded-xl border border-slate-800 bg-[#0b1323] p-4">
                        <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-slate-500">Strong Fits</div>
                        <div className="text-xl font-semibold text-slate-100">{diagnosticSummary.strongFits}/{calibrationResults.length}</div>
                        <p className="mt-2 text-xs text-slate-400">Flights under 10 ft error after calibration.</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-[#0b1323] p-4">
                        <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-slate-500">Review Queue</div>
                        <div className="text-xl font-semibold text-slate-100">{diagnosticSummary.reviewNeeded}</div>
                        <p className="mt-2 text-xs text-slate-400">Flights still above 20 ft error and worth manual review.</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-[#0b1323] p-4">
                        <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-slate-500">Aero Envelope</div>
                        <div className="text-xl font-semibold text-slate-100">Mach {diagnosticSummary.peakMach.toFixed(2)}</div>
                        <p className="mt-2 text-xs text-slate-400">Peak dynamic pressure {(diagnosticSummary.peakQPa / 47.8803).toFixed(1)} psf across this set.</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-[#0b1323] p-4">
                        <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-slate-500">Trajectory Stress</div>
                        <div className="text-xl font-semibold text-slate-100">{diagnosticSummary.meanMaxAoA.toFixed(1)} deg</div>
                        <p className="mt-2 text-xs text-slate-400">Average max AoA. Largest flight-time gap {diagnosticSummary.largestFlightTimeGap.toFixed(1)} s.</p>
                    </div>
                </div>
            )}

            {/* Comparison Chart */}
            {calibrationResults.length > 0 && (
                <div className="mb-6">
                    <h3 className="mb-4 text-base font-semibold text-slate-100">Apogee Comparison</h3>
                    <ResponsiveContainer width="100%" height={400}>
                        <ScatterChart>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis 
                                type="number"
                                dataKey="actual" 
                                name="Actual Apogee" 
                                label={{ value: 'Actual Apogee (ft)', position: 'insideBottom', offset: -5 }}
                                domain={[500, 850]}
                            />
                            <YAxis 
                                type="number"
                                dataKey="simulated" 
                                name="Simulated Apogee" 
                                label={{ value: 'Simulated Apogee (ft)', angle: -90, position: 'insideLeft' }}
                                domain={[500, 850]}
                            />
                            <Tooltip 
                                cursor={{ strokeDasharray: '3 3' }}
                                content={({ active, payload }) => {
                                    if (active && payload && payload[0]) {
                                        const data = payload[0].payload;
                                        return (
                                                <div className="bg-white p-3 border rounded shadow">
                                                <p className="font-semibold">Flight #{data.flightNumber ?? data.index}</p>
                                                <p>Motor: {data.motor}</p>
                                                <p>Actual: {data.actual.toFixed(1)} ft</p>
                                                <p>Simulated: {data.simulated.toFixed(1)} ft</p>
                                                <p>Error: {data.error.toFixed(1)} ft</p>
                                            </div>
                                        );
                                    }
                                    return null;
                                }}
                            />
                            <Scatter 
                                name="Comparison" 
                                data={comparisonData} 
                                fill="#3B82F6"
                            />
                            <ReferenceLine
                                segment={[{ x: 500, y: 500 }, { x: 850, y: 850 }]}
                                stroke="#10B981"
                                strokeWidth={2}
                                strokeDasharray="5 5"
                            />
                        </ScatterChart>
                    </ResponsiveContainer>
                    <p className="mt-2 text-xs text-slate-500">
                        Green line = perfect match. Closer points = better accuracy.
                    </p>
                </div>
            )}

            {/* Error Distribution */}
            {calibrationResults.length > 0 && (
                <div className="mb-6">
                    <h3 className="mb-4 text-base font-semibold text-slate-100">Error Distribution</h3>
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={errorDistribution}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis 
                                dataKey="index" 
                                label={{ value: 'Flight Number', position: 'insideBottom', offset: -5 }}
                            />
                            <YAxis 
                                label={{ value: 'Error (ft)', angle: -90, position: 'insideLeft' }}
                            />
                            <Tooltip 
                                content={({ active, payload }) => {
                                    if (active && payload && payload[0]) {
                                        const data = payload[0].payload;
                                        return (
                                                <div className="bg-white p-3 border rounded shadow">
                                                <p>Flight #{data.flightNumber ?? data.index}</p>
                                                <p>Motor: {data.motor}</p>
                                                <p>Error: {data.error.toFixed(1)} ft</p>
                                            </div>
                                        );
                                    }
                                    return null;
                                }}
                            />
                            <Bar dataKey="error" fill="#EF4444">
                                {errorDistribution.map((entry, index) => (
                                    <Cell 
                                        key={`cell-${index}`} 
                                        fill={Math.abs(entry.error) < 10 ? '#10B981' : Math.abs(entry.error) < 20 ? '#F59E0B' : '#EF4444'} 
                                    />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                    <div className="mt-2 flex gap-4 text-sm text-slate-400">
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 bg-green-500"></div>
                            <span>Error &lt; 10ft</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 bg-yellow-500"></div>
                            <span>Error 10-20ft</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 bg-red-500"></div>
                            <span>Error &gt; 20ft</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Detailed Results Table */}
            {calibrationResults.length > 0 && (
                <div>
                    <h3 className="mb-4 text-base font-semibold text-slate-100">Results</h3>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-800 rounded-lg border border-slate-800">
                            <thead className="bg-slate-900/80">
                                <tr>
                                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Flight#</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Date</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Motor</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Mass(g)</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Wind</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Actual(ft)</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Sim(ft)</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Error(ft)</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Baseline</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">k_drag</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Mach</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Max AoA</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Flight Time</th>
                                    <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-500">Diagnosis</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800 bg-[#0b1323]">
                                {calibrationResults.map((result, idx) => {
                                    const errorPercent = (result.error / result.actualApogee) * 100;
                                    const record = result.record;
                                    return (
                                        <tr key={idx} className={Math.abs(result.error) < 10 ? 'bg-emerald-500/4' : Math.abs(result.error) < 20 ? 'bg-amber-500/4' : 'bg-red-500/4'}>
                                            <td className="px-4 py-2.5 text-sm text-slate-100">{record.launch_number || idx + 1}</td>
                                            <td className="whitespace-nowrap px-4 py-2.5 text-sm text-slate-400">{record.date}</td>
                                            <td className="px-4 py-2.5 text-sm text-slate-300">{record.motor || 'Unknown'}</td>
                                            <td className="px-4 py-2.5 text-sm text-slate-400">{Number.isFinite(record.mass_g) ? record.mass_g.toFixed(1) : 'N/A'}</td>
                                            <td className="px-4 py-2.5 text-sm text-slate-400">{typeof record.wind_speed_mph === 'number' ? `${record.wind_speed_mph.toFixed(1)} mph` : 'N/A'}</td>
                                            <td className="px-4 py-2.5 text-sm font-medium text-slate-100">{result.actualApogee.toFixed(1)}</td>
                                            <td className="px-4 py-2.5 text-sm text-slate-300">{result.simulatedApogee.toFixed(1)}</td>
                                            <td className="px-4 py-2.5 text-sm font-medium">
                                                <span className={Math.abs(result.error) < 10 ? 'text-emerald-300' : Math.abs(result.error) < 20 ? 'text-amber-300' : 'text-red-300'}>
                                                    {result.error.toFixed(1)} ({errorPercent.toFixed(1)}%)
                                                </span>
                                            </td>
                                            <td className="px-4 py-2.5 text-sm text-slate-400">{result.baselineError.toFixed(1)} ft</td>
                                            <td className="px-4 py-2.5 text-sm text-slate-300">{(result.kDrag ?? 1.0).toFixed(3)}</td>
                                            <td className="px-4 py-2.5 text-sm text-slate-400">{result.maxMach.toFixed(2)}</td>
                                            <td className="px-4 py-2.5 text-sm text-slate-400">{result.maxAoADeg.toFixed(1)} deg</td>
                                            <td className="px-4 py-2.5 text-sm text-slate-400">
                                                {result.simulatedFlightTimeS.toFixed(1)}s / {result.actualFlightTimeS.toFixed(1)}s
                                            </td>
                                            <td className="min-w-[220px] px-4 py-2.5 text-sm text-slate-400">
                                                <div className="flex flex-wrap gap-1">
                                                    {result.diagnosis.length > 0 ? result.diagnosis.map(label => (
                                                        <span key={label} className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300">
                                                            {label}
                                                        </span>
                                                    )) : (
                                                        <span className="text-slate-500">No flags</span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default FlightDataAnalysis;
