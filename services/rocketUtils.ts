/**
 * Rocket utility functions
 * 
 * Provides shared utility functions for component mass, size calculations, etc.
 * Extracted from physics6dof.ts for reuse across multiple components and modules.
 */

import { RocketComponent } from "../types";

/**
 * Recursively calculate rocket dry mass (excluding propellant)
 */
export const calculateDryMass = (components: RocketComponent[]): number => {
    return components.reduce((acc, comp) => {
        // If component overrides subcomponents mass, only use its own mass
        if (comp.overridesSubComponents) {
            const compMass = comp.mass || 0;
            if (isNaN(compMass)) {
                console.warn(`[Mass Calc] ${comp.type} (${comp.name}): NaN detected, using 0g`);
                return acc;
            }
            return acc + compMass;
        }
        // Otherwise, sum component mass and subcomponent masses
        const subMass = comp.subComponents ? calculateDryMass(comp.subComponents) : 0;
        const compMass = comp.mass || 0;
        
        if (isNaN(compMass) || isNaN(subMass)) {
            console.warn(`[Mass Calc] ${comp.type} (${comp.name}): NaN detected, skipping`);
            return acc;
        }
        
        return acc + compMass + subMass;
    }, 0);
};

/**
 * Find rocket maximum diameter
 */
export const findMaxDiameter = (components: RocketComponent[]): number => {
    let maxD = 0;
    for (const comp of components) {
        if (comp.type === 'BODYTUBE') {
            maxD = Math.max(maxD, (comp as any).diameter || 0);
        } else if (comp.type === 'NOSECONE') {
            maxD = Math.max(maxD, (comp as any).baseDiameter || 0);
        } else if (comp.type === 'TRANSITION') {
            // Must check BOTH foreDiameter and aftDiameter explicitly
            // The old fallback chain (diameter || baseDiameter || aftDiameter) missed foreDiameter
            maxD = Math.max(maxD, (comp as any).foreDiameter || 0, (comp as any).aftDiameter || 0);
        }
        if (comp.subComponents) {
            maxD = Math.max(maxD, findMaxDiameter(comp.subComponents));
        }
    }
    return maxD;
};

/**
 * Calculate rocket reference area (circle area based on max diameter)
 */
export const calculateReferenceArea = (components: RocketComponent[]): number => {
    const maxDia = findMaxDiameter(components);
    return Math.PI * Math.pow(maxDia / 2, 2);
};
