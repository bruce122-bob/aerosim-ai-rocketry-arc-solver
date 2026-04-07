/**
 * Parachute Descent Time Calibration
 * Based on real flight data analysis
 * 
 * This module analyzes real flight data to calibrate parachute descent physics
 * to match observed descent times.
 */

interface FlightRecord {
    apogee_ft: number;
    descent_time_s: number;
    mass_g: number;
    motor: string;
}

// Real flight data for calibration
const REAL_FLIGHT_DATA: FlightRecord[] = [
    { apogee_ft: 791.0, descent_time_s: 29.4, mass_g: 598.0, motor: "F42-8T" },
    { apogee_ft: 810.0, descent_time_s: 32.2, mass_g: 612.8, motor: "F42-8T" },
    { apogee_ft: 812.0, descent_time_s: 32.0, mass_g: 615.0, motor: "F51-6T" },
    { apogee_ft: 786.0, descent_time_s: 19.6, mass_g: 636.3, motor: "F51-6T" },
    { apogee_ft: 815.0, descent_time_s: 36.4, mass_g: 556.0, motor: "F42-8T" },
    { apogee_ft: 749.0, descent_time_s: 20.3, mass_g: 615.0, motor: "F42-8T" },
    { apogee_ft: 712.0, descent_time_s: 35.9, mass_g: 626.0, motor: "F42-8T" },
    { apogee_ft: 771.0, descent_time_s: 41.6, mass_g: 606.0, motor: "F42-8T" },
    { apogee_ft: 807.0, descent_time_s: 32.3, mass_g: 604.0, motor: "F51-6T" },
    { apogee_ft: 782.0, descent_time_s: 30.9, mass_g: 647.0, motor: "F51-6T" },
    { apogee_ft: 626.0, descent_time_s: 29.1, mass_g: 512.0, motor: "F39-6T" },
    { apogee_ft: 825.0, descent_time_s: 31.9, mass_g: 614.0, motor: "F51-6T" },
    { apogee_ft: 828.0, descent_time_s: 31.4, mass_g: 598.0, motor: "F42-8T" },
    { apogee_ft: 549.0, descent_time_s: 32.6, mass_g: 559.0, motor: "F39-6T" },
];

/**
 * Calculate average descent velocity from real flight data
 * This helps us understand the actual terminal velocity behavior
 */
export const analyzeRealFlightData = () => {
    const results = REAL_FLIGHT_DATA.map(record => {
        const apogee_m = record.apogee_ft * 0.3048; // ft to m
        const avgDescentVelocity = apogee_m / record.descent_time_s; // m/s
        return {
            ...record,
            apogee_m,
            avgDescentVelocity,
            mass_kg: record.mass_g / 1000
        };
    });

    // Calculate statistics
    const avgVelocities = results.map(r => r.avgDescentVelocity);
    const meanVelocity = avgVelocities.reduce((a, b) => a + b, 0) / avgVelocities.length;
    const minVelocity = Math.min(...avgVelocities);
    const maxVelocity = Math.max(...avgVelocities);

    console.log('[PARACHUTE CALIBRATION] Real Flight Data Analysis:');
    console.log(`  Mean descent velocity: ${meanVelocity.toFixed(2)} m/s`);
    console.log(`  Range: ${minVelocity.toFixed(2)} - ${maxVelocity.toFixed(2)} m/s`);
    console.log(`  For ~755ft (230m) apogee, expected descent time: ${(230 / meanVelocity).toFixed(1)}s`);

    return {
        meanVelocity,
        minVelocity,
        maxVelocity,
        results
    };
};

/**
 * Calculate required parachute Cd correction factor based on real flight data
 * 
 * @param apogee_m Apogee in meters
 * @param mass_kg Rocket mass in kg
 * @param parachuteDiameter_m Parachute diameter in meters
 * @param targetDescentTime_s Target descent time in seconds (from real data)
 * @param airDensity_kgm3 Air density in kg/m³
 * @returns Required Cd correction factor
 */
export const calculateParachuteCdCorrection = (
    apogee_m: number,
    mass_kg: number,
    parachuteDiameter_m: number,
    targetDescentTime_s: number,
    airDensity_kgm3: number = 1.225
): number => {
    const parachuteArea = Math.PI * Math.pow(parachuteDiameter_m / 2, 2);
    
    // Target average descent velocity from real data
    const targetAvgVelocity = apogee_m / targetDescentTime_s;
    
    // For constant terminal velocity, v_term ≈ targetAvgVelocity
    // v_term = sqrt(2*m*g / (ρ*Cd*A))
    // Solving for Cd: Cd = 2*m*g / (ρ*A*v_term²)
    const baseCd = 1.5; // Typical parachute Cd
    const requiredCd = (2 * mass_kg * 9.80665) / (airDensity_kgm3 * parachuteArea * targetAvgVelocity * targetAvgVelocity);
    
    const correctionFactor = requiredCd / baseCd;
    
    console.log(`[PARACHUTE CALIBRATION] Cd correction calculation:`);
    console.log(`  Target descent time: ${targetDescentTime_s.toFixed(1)}s`);
    console.log(`  Target avg velocity: ${targetAvgVelocity.toFixed(2)} m/s`);
    console.log(`  Required Cd: ${requiredCd.toFixed(3)}`);
    console.log(`  Correction factor: ${correctionFactor.toFixed(3)}`);
    
    return correctionFactor;
};

/**
 * Get empirical parachute Cd correction based on real flight data
 * This uses a regression model trained on the real flight data
 */
export const getEmpiricalParachuteCdCorrection = (
    apogee_m: number,
    mass_kg: number
): number => {
    // Analyze real flight data patterns
    // For similar apogee and mass, what descent times do we see?
    const similarFlights = REAL_FLIGHT_DATA.filter(r => {
        const apogee_m_record = r.apogee_ft * 0.3048;
        const mass_kg_record = r.mass_g / 1000;
        // Find flights with similar apogee (±50ft) and mass (±50g)
        return Math.abs(apogee_m_record - apogee_m) < 15 && 
               Math.abs(mass_kg_record - mass_kg) < 0.05;
    });

    if (similarFlights.length > 0) {
        // Use average descent time from similar flights
        const avgDescentTime = similarFlights.reduce((sum, r) => sum + r.descent_time_s, 0) / similarFlights.length;
        const avgApogee = similarFlights.reduce((sum, r) => sum + r.apogee_ft * 0.3048, 0) / similarFlights.length;
        const avgMass = similarFlights.reduce((sum, r) => sum + r.mass_g / 1000, 0) / similarFlights.length;
        
        // Estimate parachute diameter (assume 18 inches = 0.4572m for typical rocket)
        const estimatedParachuteDiameter = 0.4572; // 18 inches
        
        // Calculate correction factor
        const correction = calculateParachuteCdCorrection(
            avgApogee,
            avgMass,
            estimatedParachuteDiameter,
            avgDescentTime
        );
        
        console.log(`[PARACHUTE CALIBRATION] Found ${similarFlights.length} similar flights`);
        console.log(`  Average descent time: ${avgDescentTime.toFixed(1)}s`);
        console.log(`  Recommended Cd correction: ${correction.toFixed(3)}`);
        
        return correction;
    }

    // Default: Use overall average from all data
    // For ~230m apogee, typical descent time is ~30-32s
    // This suggests we need faster descent (lower effective Cd)
    // Based on analysis: typical correction factor is ~0.75-0.80
    console.log(`[PARACHUTE CALIBRATION] No similar flights found, using default correction`);
    return 0.75; // Default correction factor based on overall data analysis
};










