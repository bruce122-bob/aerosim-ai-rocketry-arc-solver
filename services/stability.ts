import { RocketComponent, RocketConfig, Stage } from "../types";

/**
 * Geometry breakdown for Mach-dependent CP correction.
 * Extracted from Barrowman analysis so getCPAtMach() can reweight
 * component contributions at transonic/supersonic speeds.
 */
export interface RocketGeometryForCP {
    noseLength: number;        // nose cone length [m]
    noseShape: string;         // 'OGIVE' | 'CONICAL' | 'ELLIPSOID' etc.
    noseCpPosition: number;    // Barrowman nose CP position [m from tip]
    noseCn: number;            // nose CnAlpha contribution
    maxDiameter: number;       // reference diameter [m]
    finCpPosition: number;     // Barrowman fin CP position [m from tip]
    finCn: number;             // total fin CnAlpha contribution
    totalCn: number;           // sum of all CnAlpha
    totalLength: number;       // rocket total length [m]
    finenessRatio: number;     // totalLength / maxDiameter
}

export const resolveStabilityReferenceLength = (stages: Stage[], explicitReferenceLength?: number): number => {
    if (explicitReferenceLength && explicitReferenceLength > 0) {
        return explicitReferenceLength;
    }

    let maxDiameter = 0;
    const findMaxDia = (comps: RocketComponent[]) => {
        comps.forEach(c => {
            if (c.type === 'BODYTUBE') maxDiameter = Math.max(maxDiameter, (c as any).diameter || 0);
            if (c.type === 'NOSECONE') maxDiameter = Math.max(maxDiameter, (c as any).baseDiameter || 0);
            if (c.subComponents) findMaxDia(c.subComponents);
        });
    };
    findMaxDia(stages);
    return maxDiameter;
};

/**
 * Calculates the Center of Gravity (CG) of the rocket.
 * Returns position in meters from the tip of the nose cone (or top of the stage).
 */
export const calculateCG = (stages: Stage[], motorMass?: number, motorPosition?: number): number => {
    let totalMoment = 0;
    let totalMass = 0;

    const getComponentAxialLength = (comp: RocketComponent): number => {
        switch (comp.type) {
            case 'NOSECONE':
            case 'BODYTUBE':
            case 'TRANSITION':
            case 'INNER_TUBE':
            case 'SHOCK_CORD':
            case 'ENGINE_BLOCK':
            case 'MASS_COMPONENT':
            case 'LAUNCH_LUG':
                return (comp as any).length || 0;
            case 'FINS':
                return (comp as any).rootChord || 0;
            default:
                return 0;
        }
    };

    const resolveChildOffset = (parent: RocketComponent, child: RocketComponent): number => {
        const raw = child.position || 0;
        const parentLen = (parent as any).length || 0;
        const childLen = getComponentAxialLength(child);

        if (child.relativeTo === 'absolute') return raw;
        if (child.relativeTo === 'bottom') return parentLen - childLen + raw;
        if (child.relativeTo === 'middle') return (parentLen - childLen) / 2 + raw;
        return raw;
    };

    const traverse = (comp: RocketComponent, currentAbsPos: number) => {
        // DEBUG: output CG calculation position info
        if (comp.mass > 0) {
             console.log(`[Stability CG] Component ${comp.type} (${comp.name}): Absolute position=${(currentAbsPos*100).toFixed(1)}cm, mass=${(comp.mass*1000).toFixed(1)}g`);
        }

        // Component CG relative to its own top
        // Simplified assumptions for basic shapes:
        let localCG = 0; 
        
        // Basic geometric CG estimates
        switch (comp.type) {
            case 'NOSECONE': {
                // S-2: Shape-specific CG factors (distance from tip)
                const shape = (comp as any).shape || 'OGIVE';
                const noseLen = (comp as any).length || 0;
                if (shape === 'CONICAL') localCG = noseLen * 0.75;       // CG at 3/4 from tip
                else if (shape === 'OGIVE') localCG = noseLen * 0.50;    // CG at 1/2 from tip
                else if (shape === 'ELLIPSOID') localCG = noseLen * 0.625;
                else localCG = noseLen * 0.55;  // Default (parabolic, etc.)
                break;
            }
            case 'TRANSITION':
                // Midpoint approx
                localCG = (comp as any).length * 0.5;
                break;
            case 'BODYTUBE':
            case 'INNER_TUBE':
            case 'STAGE': // Stage itself has no mass usually, but acts as container
                localCG = (comp as any).length ? (comp as any).length * 0.5 : 0;
                break;
            case 'FINS': {
                // S-3: Standard trapezoidal centroid formula
                const cr = (comp as any).rootChord || 0;
                const ct = (comp as any).tipChord || 0;
                const sw = (comp as any).sweep || 0;
                if (cr + ct > 0) {
                    localCG = (sw / 3) * (cr + 2 * ct) / (cr + ct) +
                              (cr * cr + cr * ct + ct * ct) / (3 * (cr + ct));
                } else {
                    localCG = 0;
                }
                break;
            }
            default:
                localCG = (comp as any).length ? (comp as any).length * 0.5 : 0;
        }

        const absCG = currentAbsPos + localCG;
        
        if (comp.mass > 0) {
            totalMoment += comp.mass * absCG;
            totalMass += comp.mass;
        }

        // Recursion
        if (comp.subComponents) {
            // If Stage, sub-components are typically chained (connected in series)
            if (comp.type === 'STAGE') {
                let siblingEnd = 0;
                comp.subComponents.forEach((sub, idx) => {
                    let subPos = sub.position || 0;
                    
                    // Heuristic fix: ignore suspicious ghost gaps in chain (for abnormal offsets from auto-layout)
                    const isStructural = ['NOSECONE', 'BODYTUBE', 'TRANSITION', 'STAGE'].includes(sub.type);
                    if (isStructural && idx > 0 && sub.relativeTo !== 'absolute' && subPos > 0.01) {
                         subPos = 0;
                    }

                    let absPos = 0;
                    
                    // Only treat as absolute position when explicitly marked as 'absolute'
                    if (sub.relativeTo === 'absolute') {
                        absPos = subPos;
                    } else {
                        // Otherwise treat as relative to end of previous component (chained)
                        absPos = siblingEnd + subPos;
                    }
                    
                    traverse(sub, currentAbsPos + absPos);
                    
                    // Critical fix: only structural components advance length
                    if (isStructural) {
                        siblingEnd = absPos + ((sub as any).length || 0);
                    }
                });
            } else {
                comp.subComponents.forEach(sub => {
                    traverse(sub, currentAbsPos + resolveChildOffset(comp, sub));
                });
            }
        }
    };

    stages.forEach(stage => traverse(stage, 0));

    // C5: Include motor mass contribution if provided
    if (motorMass && motorMass > 0 && motorPosition !== undefined) {
        totalMoment += motorMass * motorPosition;
        totalMass += motorMass;
    }

    return totalMass > 0 ? totalMoment / totalMass : 0;
};

/**
 * Barrowman Equations for Center of Pressure (CP).
 * 
 * Simplified implementation covering:
 * 1. Nose Cone (CnN, Xn)
 * 2. Transitions (CnT, Xt)
 * 3. Fins (CnF, Xf)
 * 
 * Returns CP position in meters from tip.
 */
export const calculateCP = (stages: Stage[]): number => {
    let sumCn = 0;
    let sumMoment = 0;

    const getComponentAxialLength = (comp: RocketComponent): number => {
        switch (comp.type) {
            case 'NOSECONE':
            case 'BODYTUBE':
            case 'TRANSITION':
            case 'INNER_TUBE':
            case 'SHOCK_CORD':
            case 'ENGINE_BLOCK':
            case 'MASS_COMPONENT':
            case 'LAUNCH_LUG':
                return (comp as any).length || 0;
            case 'FINS':
                return (comp as any).rootChord || 0;
            default:
                return 0;
        }
    };

    const resolveChildOffset = (parent: RocketComponent, child: RocketComponent): number => {
        const raw = child.position || 0;
        const parentLen = (parent as any).length || 0;
        const childLen = getComponentAxialLength(child);

        if (child.relativeTo === 'absolute') return raw;
        if (child.relativeTo === 'bottom') return parentLen - childLen + raw;
        if (child.relativeTo === 'middle') return (parentLen - childLen) / 2 + raw;
        return raw;
    };

    // We need the reference area (Area of base of nose cone typically, or max diameter)
    // Barrowman uses the diameter of the rocket at the base of the nose cone as reference usually, 
    // but usually we normalize to max diameter.
    let maxDiameter = 0;
    const findMaxDia = (comps: RocketComponent[]) => {
        comps.forEach(c => {
            if (c.type === 'BODYTUBE') maxDiameter = Math.max(maxDiameter, (c as any).diameter || 0);
            if (c.type === 'NOSECONE') maxDiameter = Math.max(maxDiameter, (c as any).baseDiameter || 0);
            if (c.subComponents) findMaxDia(c.subComponents);
        });
    };
    findMaxDia(stages);

    if (maxDiameter === 0) return 0;
    const refArea = Math.PI * Math.pow(maxDiameter/2, 2); // A_ref

    const traverse = (comp: RocketComponent, currentAbsPos: number) => {
        // DEBUG: output absolute position of each component for verification
        if (comp.type === 'NOSECONE' || comp.type === 'BODYTUBE' || comp.type === 'TRANSITION' || comp.type === 'FINS') {
             console.log(`[Stability] Component ${comp.type} (${comp.name}): Absolute position = ${(currentAbsPos * 100).toFixed(1)} cm`);
        }

        if (comp.type === 'NOSECONE') {
            // ... (No change)
            const L = (comp as any).length || 0;
            const D = (comp as any).baseDiameter || 0;
            const cn = 2 * Math.pow(D / maxDiameter, 2);
            let xn_factor = 0.5;
            const shape = String((comp as any).shape || '').toUpperCase();
            if (shape === 'CONICAL') xn_factor = 0.666;
            if (shape === 'OGIVE') xn_factor = 0.466;
            // OpenRocket's ellipsoid / elliptical nose CP sits noticeably farther forward than ogive.
            // Using the ogive factor here was biasing imported static CP aft by about 0.4 in.
            if (shape === 'ELLIPSOID' || shape === 'ELLIPTICAL') xn_factor = 0.333;
            const xn = currentAbsPos + (L * xn_factor);
            sumCn += cn;
            sumMoment += cn * xn;
        } else if (comp.type === 'TRANSITION') {
            // ... (No change)
            const d_f = (comp as any).foreDiameter || 0;
            const d_r = (comp as any).aftDiameter || 0;
            const L = (comp as any).length || 0;
            const cn = 2 * (Math.pow(d_r/maxDiameter, 2) - Math.pow(d_f/maxDiameter, 2));
            const xt = currentAbsPos + (L/2); 
            sumCn += cn;
            sumMoment += cn * xt;
        } else if (comp.type === 'FINS') {
            // ... (No change)
            const N = (comp as any).finCount || 3;
            const root = (comp as any).rootChord || 0;
            const tip = (comp as any).tipChord || 0;
            const span = (comp as any).height || 0;
            const sweep = (comp as any).sweep || 0;
            const r_body = maxDiameter / 2; 
            const K = 1 + (r_body / (r_body + span));
            const num = 4 * N * Math.pow(span / maxDiameter, 2);
            const denom = 1 + Math.sqrt(1 + Math.pow( (2 * span) / (root + tip), 2));
            // S-4: Standard Barrowman formula (no engineering fudge factor)
            // Previous 0.55 factor was removed — use unmodified Barrowman for transparency
            const cn = K * (num / denom);
            const xr = root;
            const xt = tip;
            const xs = sweep;
            let x_local = 0;
            if (xr + xt > 0) {
                 x_local = (xs/3) * ((xr + 2*xt)/(xr+xt)) + (1/6) * (xr + xt - (xr*xt)/(xr+xt));
            }
            const xf = currentAbsPos + x_local;
            sumCn += cn;
            sumMoment += cn * xf;
        }

        // Recursion with Chain Logic
        if (comp.subComponents) {
            if (comp.type === 'STAGE') {
                let siblingEnd = 0;
                comp.subComponents.forEach((sub, idx) => {
                    let subPos = sub.position || 0;
                    
                    // Heuristic fix: ignore suspicious ghost gaps in chain
                    const isStructural = ['NOSECONE', 'BODYTUBE', 'TRANSITION', 'STAGE'].includes(sub.type);
                    if (isStructural && idx > 0 && sub.relativeTo !== 'absolute' && subPos > 0.01) {
                         subPos = 0;
                    }

                    let absPos = 0;
                    
                    // Only treat as absolute position when explicitly marked as 'absolute'
                    if (sub.relativeTo === 'absolute') {
                        absPos = subPos;
                    } else {
                        // Otherwise treat as relative to end of previous component (chained)
                        absPos = siblingEnd + subPos;
                    }
                    
                    traverse(sub, currentAbsPos + absPos);
                    
                    // Critical fix: only structural components advance length
                    if (isStructural) {
                        siblingEnd = absPos + ((sub as any).length || 0);
                    }
                });
            } else {
                // For sibling sub-components within container (e.g. Fins, InnerTube inside BodyTube)
                comp.subComponents.forEach(sub => {
                    traverse(sub, currentAbsPos + resolveChildOffset(comp, sub));
                });
            }
        }
    };

    stages.forEach(stage => traverse(stage, 0));

    return sumCn > 0 ? sumMoment / sumCn : 0;
};

/**
 * Extract per-component CP geometry from Barrowman analysis.
 * Same traversal logic as calculateCP() but returns individual contributions
 * so getCPAtMach() can reweight them at different Mach numbers.
 */
export const extractCPGeometry = (stages: Stage[]): RocketGeometryForCP => {
    let maxDiameter = 0;
    let totalLength = 0;

    // Nose data
    let noseLength = 0;
    let noseShape = 'OGIVE';
    let noseCpPosition = 0;
    let noseCn = 0;

    // Fin data (aggregate)
    let finCpPosition = 0;
    let finCn = 0;

    // Total
    let totalCn = 0;

    // Find max diameter
    const findMaxDia = (comps: RocketComponent[]) => {
        comps.forEach(c => {
            if (c.type === 'BODYTUBE') maxDiameter = Math.max(maxDiameter, (c as any).diameter || 0);
            if (c.type === 'NOSECONE') maxDiameter = Math.max(maxDiameter, (c as any).baseDiameter || 0);
            if (c.subComponents) findMaxDia(c.subComponents);
        });
    };
    findMaxDia(stages);

    if (maxDiameter === 0) {
        return {
            noseLength: 0, noseShape: 'OGIVE', noseCpPosition: 0, noseCn: 0,
            maxDiameter: 0, finCpPosition: 0, finCn: 0, totalCn: 0,
            totalLength: 0, finenessRatio: 10
        };
    }

    const getComponentAxialLength = (comp: RocketComponent): number => {
        switch (comp.type) {
            case 'NOSECONE': case 'BODYTUBE': case 'TRANSITION':
            case 'INNER_TUBE': case 'SHOCK_CORD': case 'ENGINE_BLOCK':
            case 'MASS_COMPONENT': case 'LAUNCH_LUG':
                return (comp as any).length || 0;
            case 'FINS':
                return (comp as any).rootChord || 0;
            default:
                return 0;
        }
    };

    const resolveChildOffset = (parent: RocketComponent, child: RocketComponent): number => {
        const raw = child.position || 0;
        const parentLen = (parent as any).length || 0;
        const childLen = getComponentAxialLength(child);
        if (child.relativeTo === 'absolute') return raw;
        if (child.relativeTo === 'bottom') return parentLen - childLen + raw;
        if (child.relativeTo === 'middle') return (parentLen - childLen) / 2 + raw;
        return raw;
    };

    // Aggregate fin Cn×Xcp for weighted position
    let finMoment = 0;

    const traverse = (comp: RocketComponent, currentAbsPos: number) => {
        // Track total length
        const compEnd = currentAbsPos + getComponentAxialLength(comp);
        if (compEnd > totalLength) totalLength = compEnd;

        if (comp.type === 'NOSECONE') {
            const L = (comp as any).length || 0;
            const D = (comp as any).baseDiameter || 0;
            const cn = 2 * Math.pow(D / maxDiameter, 2);
            let xn_factor = 0.5;
            const shape = String((comp as any).shape || '').toUpperCase();
            if (shape === 'CONICAL') xn_factor = 0.666;
            if (shape === 'OGIVE') xn_factor = 0.466;
            if (shape === 'ELLIPSOID' || shape === 'ELLIPTICAL') xn_factor = 0.333;
            const xn = currentAbsPos + (L * xn_factor);

            noseLength = L;
            noseShape = shape || 'OGIVE';
            noseCpPosition = xn;
            noseCn = cn;
            totalCn += cn;
        } else if (comp.type === 'TRANSITION') {
            const d_f = (comp as any).foreDiameter || 0;
            const d_r = (comp as any).aftDiameter || 0;
            const cn = 2 * (Math.pow(d_r / maxDiameter, 2) - Math.pow(d_f / maxDiameter, 2));
            totalCn += cn;
            // Transitions are small contributors; lump into total but not nose/fin
        } else if (comp.type === 'FINS') {
            const N = (comp as any).finCount || 3;
            const root = (comp as any).rootChord || 0;
            const tip = (comp as any).tipChord || 0;
            const span = (comp as any).height || 0;
            const sweep = (comp as any).sweep || 0;
            const r_body = maxDiameter / 2;
            const K = 1 + (r_body / (r_body + span));
            const num = 4 * N * Math.pow(span / maxDiameter, 2);
            const denom = 1 + Math.sqrt(1 + Math.pow((2 * span) / (root + tip), 2));
            const cn = K * (num / denom);

            const xr = root;
            const xt = tip;
            const xs = sweep;
            let x_local = 0;
            if (xr + xt > 0) {
                x_local = (xs / 3) * ((xr + 2 * xt) / (xr + xt)) + (1 / 6) * (xr + xt - (xr * xt) / (xr + xt));
            }
            const xf = currentAbsPos + x_local;

            finCn += cn;
            finMoment += cn * xf;
            totalCn += cn;
        }

        // Recursion (same chain logic as calculateCP)
        if (comp.subComponents) {
            if (comp.type === 'STAGE') {
                let siblingEnd = 0;
                comp.subComponents.forEach((sub, idx) => {
                    let subPos = sub.position || 0;
                    const isStructural = ['NOSECONE', 'BODYTUBE', 'TRANSITION', 'STAGE'].includes(sub.type);
                    if (isStructural && idx > 0 && sub.relativeTo !== 'absolute' && subPos > 0.01) {
                        subPos = 0;
                    }
                    let absPos = 0;
                    if (sub.relativeTo === 'absolute') {
                        absPos = subPos;
                    } else {
                        absPos = siblingEnd + subPos;
                    }
                    traverse(sub, currentAbsPos + absPos);
                    if (isStructural) {
                        siblingEnd = absPos + ((sub as any).length || 0);
                    }
                });
            } else {
                comp.subComponents.forEach(sub => {
                    traverse(sub, currentAbsPos + resolveChildOffset(comp, sub));
                });
            }
        }
    };

    stages.forEach(stage => traverse(stage, 0));

    // Compute weighted fin CP position
    if (finCn > 0) {
        finCpPosition = finMoment / finCn;
    }

    const finenessRatio = maxDiameter > 0 ? totalLength / maxDiameter : 10;

    return {
        noseLength,
        noseShape,
        noseCpPosition,
        noseCn,
        maxDiameter,
        finCpPosition,
        finCn,
        totalCn,
        totalLength,
        finenessRatio
    };
};

/**
 * Mach-dependent Center of Pressure correction.
 *
 * Barrowman CP (cpBase) is only valid for M < ~0.8. At higher Mach:
 * - Transonic (0.8-1.2): nose cone CP moves aft toward 2/3 of nose length
 *   (shock-dominated flow replaces subsonic pressure distribution)
 * - Supersonic (>1.2): fin CnAlpha changes per Ackeret linearized theory
 *   (4 / sqrt(M²-1)), shifting the overall CP
 *
 * Returns adjusted CP position [m from tip].
 * For M < 0.8, returns cpBase unchanged (backward compatible).
 */
export const getCPAtMach = (cpBase: number, mach: number, geometry: RocketGeometryForCP): number => {
    // Subsonic: pure Barrowman, no correction
    if (mach < 0.8 || !geometry || geometry.totalCn <= 0) return cpBase;

    const { noseLength, noseShape, noseCpPosition, noseCn, finCpPosition, finCn, totalCn } = geometry;

    // --- Nose cone CP shift ---
    // In supersonic flow, shock-dominated pressure moves CP toward 2/3 of nose length
    const SUPERSONIC_NOSE_FACTOR = 0.667;
    let barrowmanNoseFactor: number;
    switch (noseShape) {
        case 'CONICAL':   barrowmanNoseFactor = 0.666; break;
        case 'OGIVE':     barrowmanNoseFactor = 0.466; break;
        case 'ELLIPSOID':
        case 'ELLIPTICAL': barrowmanNoseFactor = 0.333; break;
        default:          barrowmanNoseFactor = 0.5; break;
    }
    const maxNoseShift = noseLength * (SUPERSONIC_NOSE_FACTOR - barrowmanNoseFactor);

    // --- Transonic region (M 0.8 to 1.2): smooth ramp ---
    if (mach < 1.2) {
        const t = (mach - 0.8) / 0.4;  // 0 → 1
        const smoothT = t * t * (3 - 2 * t);  // Hermite smoothstep (C1 continuous)
        // Shift overall CP by nose contribution fraction
        const noseWeight = noseCn / totalCn;
        const cpShift = maxNoseShift * smoothT * noseWeight;
        return cpBase + cpShift;
    }

    // --- Supersonic (M ≥ 1.2): full nose CP shift ---
    // In supersonic flow, the shock-dominated pressure distribution pushes the
    // nose cone CP to ~2/3 of its length. Overall, rockets become MORE stable
    // (CP moves aft) at supersonic speeds.
    //
    // The primary effect is the nose CP shift. We keep fin contributions
    // unchanged from Barrowman (conservative, avoids incorrect Ackeret scaling).
    const noseWeight = noseCn / totalCn;
    return cpBase + maxNoseShift * noseWeight;
};

/**
 * Calculate complete stability analysis
 * Returns CG, CP, stability margin, and stability status
 * @param stages - Rocket stages
 * @param referenceLength - Optional reference length from .ork file (OpenRocket's reference length)
 *                          If not provided, uses max diameter (caliber)
 */
export const calculateStability = (stages: Stage[], referenceLength?: number) => {
    const cg = calculateCG(stages);
    const cp = calculateCP(stages);
    
    // Determine reference length for stability calculation
    const refLength = resolveStabilityReferenceLength(stages, referenceLength);

    if (referenceLength && referenceLength > 0) {
        // Use reference length from .ork file (OpenRocket's method)
        console.log(`[Stability] Using referenceLength from .ork file: ${refLength}m (${(refLength * 39.3701).toFixed(2)}in)`);
    } else {
        console.log(`[Stability] Using max diameter as reference length: ${refLength}m (${(refLength * 39.3701).toFixed(2)}in)`);
    }
    
    // Stability margin in calibers (CP - CG) / reference length
    // Positive margin means CP is behind CG (stable)
    const stabilityMargin = refLength > 0 ? (cp - cg) / refLength : 0;
    
    // Generally stable if margin > 1.0 calibers
    const isStable = stabilityMargin >= 1.0;
    
    // S-7: Explicit stability warnings
    if (stabilityMargin < 0) {
        console.error(`[Stability] ❌ UNSTABLE: CP (${(cp * 1000).toFixed(1)}mm) is AHEAD of CG (${(cg * 1000).toFixed(1)}mm). Margin: ${stabilityMargin.toFixed(2)} calibers`);
    } else if (stabilityMargin < 1.0) {
        console.warn(`[Stability] ⚠️ MARGINAL: Stability margin ${stabilityMargin.toFixed(2)} calibers (< 1.0). Rocket may be marginally stable.`);
    }
    
    return {
        cg,
        cp,
        stabilityMargin,
        isStable
    };
};
