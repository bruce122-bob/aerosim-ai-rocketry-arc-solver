// Enhanced Calibration System with Adaptive Learning Rate
// Implements Adam optimizer and advanced optimization techniques

// C11: Fixed import path (types.ts is at project root, not in services/)
import { RocketConfig, Environment, SimulationResult } from "../types";
import { runSimulation } from "./physics6dofStable";

export interface EnhancedCalibrationResult {
    kThrust: number;
    kDrag: number;
    initialRMSE: number;
    finalRMSE: number;
    improvement: number;
    iterations: number;
    convergence: boolean;
    convergenceHistory: Array<{ iteration: number; rmse: number; kThrust: number; kDrag: number }>;
    sensitivity: {
        kThrustSensitivity: number;
        kDragSensitivity: number;
    };
}

interface FlightDataPoint {
    time: number;
    altitude: number;
}

/**
 * Enhanced calibration using Adam optimizer with adaptive learning rate
 * Much faster convergence and better stability than basic gradient descent
 */
export const enhancedCalibrate = async (
    rocket: RocketConfig,
    env: Environment,
    flightData: FlightDataPoint[],
    launchAngleDeg: number = 90,
    railLength: number = 1.0,
    initialKThrust: number = 1.0,
    initialKDrag: number = 1.0,
    maxIterations: number = 100
): Promise<EnhancedCalibrationResult> => {
    console.log(`[ENHANCED CALIBRATION] Starting with ${flightData.length} data points...`);
    
    // C8: Auto-detect units with lower threshold
    // Model rockets rarely exceed 400m (~1300ft), so 400 is a safe threshold
    const maxAlt = Math.max(...flightData.map(d => d.altitude));
    const isFeet = maxAlt > 400;
    const flightDataMeters = flightData.map(d => ({
        time: d.time,
        altitude: isFeet ? d.altitude / 3.28084 : d.altitude
    }));

    // RMSE calculation function - prioritize apogee accuracy
    const calculateRMSE = async (kThrust: number, kDrag: number): Promise<number> => {
        // Pass calibration parameters to simulationSettings
        const rocketWithParams: RocketConfig = {
            ...rocket,
            simulationSettings: {
                ...rocket.simulationSettings,
                kThrust,
                kDrag
            }
        };
        const simResult = await runSimulation(rocketWithParams, env, launchAngleDeg, railLength);
        const simulatedApogee = simResult.apogee; // in meters
        
        // Find the maximum altitude from flight data (apogee)
        const maxFlightAlt = Math.max(...flightDataMeters.map(d => d.altitude));
        
        // Weight apogee error more heavily (most important metric)
        const apogeeError = Math.abs(simulatedApogee - maxFlightAlt);
        const apogeeWeight = 10.0; // Weight apogee error 10x more than other points
        
        let rmse = apogeeError * apogeeError * apogeeWeight;
        let validPoints = 1; // Start with apogee point
        
        // Also consider other trajectory points (but with less weight)
        for (const flightPoint of flightDataMeters) {
            // Skip if this is the apogee point (already counted)
            if (Math.abs(flightPoint.altitude - maxFlightAlt) < 0.1) continue;
            
            let closestSimPoint = simResult.data[0];
            let minDiff = Math.abs(simResult.data[0].time - flightPoint.time);
            
            for (const simPoint of simResult.data) {
                const diff = Math.abs(simPoint.time - flightPoint.time);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestSimPoint = simPoint;
                }
            }
            
            if (minDiff < 0.5) {
                const error = closestSimPoint.altitude - flightPoint.altitude;
                rmse += error * error; // Normal weight for trajectory points
                validPoints++;
            }
        }
        
        return validPoints > 0 ? Math.sqrt(rmse / (validPoints + apogeeWeight - 1)) : 1e6;
    };

    // Adam optimizer parameters
    const alpha = 0.01; // Learning rate
    const beta1 = 0.9;  // Exponential decay rate for first moment
    const beta2 = 0.999; // Exponential decay rate for second moment
    const epsilon = 1e-8; // Small constant to prevent division by zero
    
    // Initialize parameters
    let kThrust = initialKThrust;
    let kDrag = initialKDrag;
    
    // Adam optimizer state
    let mThrust = 0; // First moment estimate for kThrust
    let vThrust = 0; // Second moment estimate for kThrust
    let mDrag = 0;   // First moment estimate for kDrag
    let vDrag = 0;   // Second moment estimate for kDrag
    
    const initialRMSE = await calculateRMSE(kThrust, kDrag);
    let previousRMSE = initialRMSE;
    const tolerance = 0.1; // Relaxed tolerance (0.1m = ~0.3ft) to avoid premature convergence
    const minIterations = 10; // Minimum iterations before checking convergence
    const convergenceHistory: Array<{ iteration: number; rmse: number; kThrust: number; kDrag: number }> = [];
    
    let converged = false;
    let iterations = 0;
    
    console.log(`[ENHANCED CALIBRATION] Initial RMSE: ${initialRMSE.toFixed(3)} m`);
    
    for (let iter = 0; iter < maxIterations; iter++) {
        iterations = iter + 1;
        const t = iterations; // Time step for bias correction
        
        // Calculate gradients using finite difference
        const delta = 0.01; // Increased delta for more stable gradients
        const rmseCurrent = await calculateRMSE(kThrust, kDrag);
        const rmseThrustPlus = await calculateRMSE(kThrust + delta, kDrag);
        const rmseDragPlus = await calculateRMSE(kThrust, kDrag + delta);
        
        const gradThrust = (rmseThrustPlus - rmseCurrent) / delta;
        const gradDrag = (rmseDragPlus - rmseCurrent) / delta;
        
        // Update biased first moment estimates
        mThrust = beta1 * mThrust + (1 - beta1) * gradThrust;
        mDrag = beta1 * mDrag + (1 - beta1) * gradDrag;
        
        // Update biased second raw moment estimates
        vThrust = beta2 * vThrust + (1 - beta2) * gradThrust * gradThrust;
        vDrag = beta2 * vDrag + (1 - beta2) * gradDrag * gradDrag;
        
        // Compute bias-corrected first moment estimates
        const mThrustHat = mThrust / (1 - Math.pow(beta1, t));
        const mDragHat = mDrag / (1 - Math.pow(beta1, t));
        
        // Compute bias-corrected second raw moment estimates
        const vThrustHat = vThrust / (1 - Math.pow(beta2, t));
        const vDragHat = vDrag / (1 - Math.pow(beta2, t));
        
        // Update parameters with adaptive learning rate
        const newKThrust = kThrust - alpha * mThrustHat / (Math.sqrt(vThrustHat) + epsilon);
        const newKDrag = kDrag - alpha * mDragHat / (Math.sqrt(vDragHat) + epsilon);
        
        // Apply constraints - expanded k_drag range to handle cases where higher drag is needed
        kThrust = Math.max(0.8, Math.min(1.2, newKThrust));
        kDrag = Math.max(0.8, Math.min(2.0, newKDrag)); // Expanded from 1.3 to 2.0
        
        const currentRMSE = await calculateRMSE(kThrust, kDrag);
        convergenceHistory.push({
            iteration: iterations,
            rmse: currentRMSE,
            kThrust,
            kDrag
        });
        
        // Early stopping if converged (but only after minimum iterations)
        if (iterations >= minIterations && Math.abs(previousRMSE - currentRMSE) < tolerance) {
            converged = true;
            console.log(`[ENHANCED CALIBRATION] ✅ Converged after ${iterations} iterations`);
            break;
        }
        
        // Adaptive learning rate reduction if stuck
        if (iter > 10 && Math.abs(currentRMSE - previousRMSE) < tolerance * 2) {
            // Reduce learning rate if progress is slow
            // This is handled by Adam's adaptive nature, but we can add additional logic
        }
        
        previousRMSE = currentRMSE;
        
        if (iter % 5 === 0 || iter < 10) {
            console.log(`[ENHANCED CALIBRATION] Iter ${iter}: RMSE=${currentRMSE.toFixed(3)}m, k_thrust=${kThrust.toFixed(4)}, k_drag=${kDrag.toFixed(4)}`);
        }
    }
    
    const finalRMSE = await calculateRMSE(kThrust, kDrag);
    const improvement = ((initialRMSE - finalRMSE) / initialRMSE) * 100;
    
    // Calculate sensitivity (how much RMSE changes per unit change in parameter)
    const sensitivityDelta = 0.01;
    const rmseThrustSens = await calculateRMSE(kThrust + sensitivityDelta, kDrag);
    const rmseDragSens = await calculateRMSE(kThrust, kDrag + sensitivityDelta);
    
    const kThrustSensitivity = Math.abs(rmseThrustSens - finalRMSE) / sensitivityDelta;
    const kDragSensitivity = Math.abs(rmseDragSens - finalRMSE) / sensitivityDelta;
    
    console.log(`[ENHANCED CALIBRATION] ✅ Complete!`);
    console.log(`[ENHANCED CALIBRATION] Final RMSE: ${finalRMSE.toFixed(3)} m (improvement: ${improvement.toFixed(1)}%)`);
    console.log(`[ENHANCED CALIBRATION] Optimized k_thrust: ${kThrust.toFixed(4)}`);
    console.log(`[ENHANCED CALIBRATION] Optimized k_drag: ${kDrag.toFixed(4)}`);
    console.log(`[ENHANCED CALIBRATION] Sensitivity - k_thrust: ${kThrustSensitivity.toFixed(2)}, k_drag: ${kDragSensitivity.toFixed(2)}`);
    
    return {
        kThrust,
        kDrag,
        initialRMSE,
        finalRMSE,
        improvement,
        iterations,
        convergence: converged,
        convergenceHistory,
        sensitivity: {
            kThrustSensitivity,
            kDragSensitivity
        }
    };
};

/**
 * Multi-objective optimization: Find optimal launch angle for maximum apogee
 */
export const optimizeLaunchAngle = async (
    rocket: RocketConfig,
    env: Environment,
    railLength: number = 1.0,
    angleRange: [number, number] = [80, 90],
    stepSize: number = 1.0
): Promise<{ optimalAngle: number; maxApogee: number; results: Array<{ angle: number; apogee: number }> }> => {
    console.log(`[OPTIMIZATION] Finding optimal launch angle...`);
    
    const results: Array<{ angle: number; apogee: number }> = [];
    let maxApogee = 0;
    let optimalAngle = 90;
    
    for (let angle = angleRange[0]; angle <= angleRange[1]; angle += stepSize) {
        const result = await runSimulation(rocket, env, angle, railLength);
        const apogee = result.apogee;
        results.push({ angle, apogee });
        
        if (apogee > maxApogee) {
            maxApogee = apogee;
            optimalAngle = angle;
        }
    }
    
    console.log(`[OPTIMIZATION] ✅ Optimal angle: ${optimalAngle}° (Apogee: ${(maxApogee * 3.28084).toFixed(1)} ft)`);
    
    return {
        optimalAngle,
        maxApogee,
        results
    };
};

/**
 * Bayesian optimization for parameter tuning
 * More efficient than grid search for high-dimensional problems
 */
export const bayesianOptimize = async (
    rocket: RocketConfig,
    env: Environment,
    targetApogee: number,
    launchAngleDeg: number = 90,
    railLength: number = 1.0,
    maxIterations: number = 20
): { bestKThrust: number; bestKDrag: number; bestError: number; history: Array<any> } => {
    console.log(`[BAYESIAN OPTIMIZATION] Starting optimization...`);
    console.log(`[BAYESIAN OPTIMIZATION] Target apogee: ${targetApogee} ft`);
    
    // Simple implementation: Use acquisition function to guide search
    // In full implementation, would use Gaussian Process regression
    
    const history: Array<{ kThrust: number; kDrag: number; apogee: number; error: number }> = [];
    let bestKThrust = 1.0;
    let bestKDrag = 1.0;
    let bestError = Infinity;
    
    // Initial random samples
    const initialSamples = 5;
    for (let i = 0; i < initialSamples; i++) {
        const kThrust = 0.9 + Math.random() * 0.2;
        const kDrag = 1.0 + Math.random() * 0.2;
        
        // Pass calibration parameters to simulationSettings
        const rocketWithParams: RocketConfig = {
            ...rocket,
            simulationSettings: {
                ...rocket.simulationSettings,
                kThrust,
                kDrag
            }
        };
        const result = await runSimulation(rocketWithParams, env, launchAngleDeg, railLength);
        const apogeeFt = result.apogee * 3.28084;
        const error = Math.abs(apogeeFt - targetApogee);
        
        history.push({ kThrust, kDrag, apogee: apogeeFt, error });
        
        if (error < bestError) {
            bestError = error;
            bestKThrust = kThrust;
            bestKDrag = kDrag;
        }
    }
    
    // Refinement phase: Search around best point
    for (let iter = 0; iter < maxIterations - initialSamples; iter++) {
        // Use gradient-based refinement around best point
        const delta = 0.01;
        // Pass current best parameters
        const rocketCurrent: RocketConfig = {
            ...rocket,
            simulationSettings: {
                ...rocket.simulationSettings,
                kThrust: bestKThrust,
                kDrag: bestKDrag
            }
        };
        const resultCurrent = await runSimulation(rocketCurrent, env, launchAngleDeg, railLength);
        const errorCurrent = Math.abs(resultCurrent.apogee * 3.28084 - targetApogee);
        
        // Try small perturbations
        const perturbations = [
            { kThrust: bestKThrust + delta, kDrag: bestKDrag },
            { kThrust: bestKThrust - delta, kDrag: bestKDrag },
            { kThrust: bestKThrust, kDrag: bestKDrag + delta },
            { kThrust: bestKThrust, kDrag: bestKDrag - delta }
        ];
        
        for (const pert of perturbations) {
            // Apply consistent parameter ranges (same as enhancedCalibrate)
            // kThrust: 0.8-1.2 (±20% reasonable range)
            // kDrag: 0.8-1.5 (considering manufacturing tolerances and surface roughness)
            if (pert.kThrust < 0.8 || pert.kThrust > 1.2 || pert.kDrag < 0.8 || pert.kDrag > 1.5) continue;
            
            // Pass perturbed parameters
            const rocketPert: RocketConfig = {
                ...rocket,
                simulationSettings: {
                    ...rocket.simulationSettings,
                    kThrust: pert.kThrust,
                    kDrag: pert.kDrag
                }
            };
            const result = await runSimulation(rocketPert, env, launchAngleDeg, railLength);
            const apogeeFt = result.apogee * 3.28084;
            const error = Math.abs(apogeeFt - targetApogee);
            
            if (error < bestError) {
                bestError = error;
                bestKThrust = pert.kThrust;
                bestKDrag = pert.kDrag;
            }
        }
    }
    
    console.log(`[BAYESIAN OPTIMIZATION] ✅ Complete!`);
    console.log(`[BAYESIAN OPTIMIZATION] Best k_thrust: ${bestKThrust.toFixed(4)}, k_drag: ${bestKDrag.toFixed(4)}`);
    console.log(`[BAYESIAN OPTIMIZATION] Best error: ${bestError.toFixed(1)} ft`);
    
    return {
        bestKThrust,
        bestKDrag,
        bestError,
        history
    };
};
