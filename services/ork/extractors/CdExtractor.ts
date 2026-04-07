/**
 * CdExtractor - Unified drag coefficient extraction with priority-based resolution
 * 
 * Extracts Cd values from multiple sources in OpenRocket files and selects
 * the most reliable value based on a defined priority order.
 * 
 * Priority Order:
 * 1. User manual override (from UI)
 * 2. stage/overridecd (user-set in OpenRocket)
 * 3. rocket/overridecd
 * 4. simulation/flightdata/cd (calculated result)
 * 5. rocket/cd
 * 6. Default value (0.55)
 */

import { CdValue } from '../types';

export interface CdExtractionOptions {
    userOverride?: number;
    defaultValue?: number;
}

export class CdExtractor {
    // Priority levels (lower = higher priority)
    static readonly PRIORITY = {
        USER_OVERRIDE: 0,
        STAGE_OVERRIDECD: 1,
        ROCKET_OVERRIDECD: 2,
        SIMULATION_CD: 3,
        ROCKET_CD: 4,
        DEFAULT: 5
    };

    private candidates: CdValue[] = [];
    private doc: Document;

    constructor(doc: Document) {
        this.doc = doc;
    }

    /**
     * Extract Cd from all sources and return the highest priority valid value
     */
    extract(options: CdExtractionOptions = {}): CdValue {
        const { userOverride, defaultValue = 0.55 } = options;

        // Priority 0: User override from UI
        if (userOverride !== undefined && userOverride > 0) {
            this.addCandidate(userOverride, 'user_override', CdExtractor.PRIORITY.USER_OVERRIDE);
        }

        // Priority 1: stage/overridecd
        this.extractFromStages();

        // Priority 2: rocket/overridecd
        this.extractFromRocketOverride();

        // Priority 3: simulation/flightdata/cd
        this.extractFromSimulations();

        // Priority 4: rocket/cd
        this.extractFromRocket();

        // Priority 5: Default
        this.addCandidate(defaultValue, 'default', CdExtractor.PRIORITY.DEFAULT);

        // Sort by priority and return best
        this.candidates.sort((a, b) => a.priority - b.priority);

        const best = this.candidates[0];
        console.log(`[CdExtractor] Selected: ${best.value.toFixed(4)} from "${best.source}" (priority ${best.priority})`);

        if (this.candidates.length > 1) {
            console.log(`[CdExtractor] Other candidates:`,
                this.candidates.slice(1).map(c => `${c.value.toFixed(4)} (${c.source})`).join(', ')
            );
        }

        return best;
    }

    private addCandidate(value: number, source: string, priority: number) {
        if (value > 0 && isFinite(value)) {
            this.candidates.push({ value, source, priority });
        }
    }

    private extractFromStages() {
        // Use getElementsByTagName for xmldom compatibility
        const stages = this.doc.getElementsByTagName('stage');

        for (let i = 0; i < stages.length; i++) {
            const stage = stages[i];
            const overrideCdElements = stage.getElementsByTagName('overridecd');

            if (overrideCdElements.length > 0 && overrideCdElements[0].textContent) {
                const value = parseFloat(overrideCdElements[0].textContent);
                if (value > 0 && value !== 0.5) { // 0.5 is often default, skip it
                    this.addCandidate(value, `stage[${i}]/overridecd`, CdExtractor.PRIORITY.STAGE_OVERRIDECD);
                }
            }
        }
    }

    private extractFromRocketOverride() {
        const rockets = this.doc.getElementsByTagName('rocket');
        if (rockets.length === 0) return;
        const rocket = rockets[0];

        // Find direct child overridecd
        const overrideCdElements = rocket.getElementsByTagName('overridecd');
        if (overrideCdElements.length > 0 && overrideCdElements[0].textContent) {
            const value = parseFloat(overrideCdElements[0].textContent);
            if (value > 0 && value !== 0.5) {
                this.addCandidate(value, 'rocket/overridecd', CdExtractor.PRIORITY.ROCKET_OVERRIDECD);
            }
        }
    }

    private extractFromSimulations() {
        const simulations = this.doc.getElementsByTagName('simulation');

        for (let i = 0; i < simulations.length; i++) {
            const sim = simulations[i];

            // Check flightdata/cd
            const flightDataList = sim.getElementsByTagName('flightdata');
            if (flightDataList.length > 0) {
                const cdElements = flightDataList[0].getElementsByTagName('cd');
                if (cdElements.length > 0 && cdElements[0].textContent) {
                    const value = parseFloat(cdElements[0].textContent);
                    if (value > 0) {
                        this.addCandidate(value, `simulation[${i}]/flightdata/cd`, CdExtractor.PRIORITY.SIMULATION_CD);
                    }
                }
            }

            // Check flightconfiguration/cd
            const flightConfigList = sim.getElementsByTagName('flightconfiguration');
            if (flightConfigList.length > 0) {
                const cdElements = flightConfigList[0].getElementsByTagName('cd');
                if (cdElements.length > 0 && cdElements[0].textContent) {
                    const value = parseFloat(cdElements[0].textContent);
                    if (value > 0) {
                        this.addCandidate(value, `simulation[${i}]/flightconfiguration/cd`, CdExtractor.PRIORITY.SIMULATION_CD);
                    }
                }
            }
        }
    }

    private extractFromRocket() {
        const rockets = this.doc.getElementsByTagName('rocket');
        if (rockets.length === 0) return;
        const rocket = rockets[0];

        // Find direct child cd element
        const cdElements = rocket.getElementsByTagName('cd');
        if (cdElements.length > 0 && cdElements[0].textContent) {
            const value = parseFloat(cdElements[0].textContent);
            if (value > 0 && value !== 0.5) {
                this.addCandidate(value, 'rocket/cd', CdExtractor.PRIORITY.ROCKET_CD);
            }
        }
    }

    /**
     * Static convenience method
     */
    static extract(doc: Document, options?: CdExtractionOptions): CdValue {
        return new CdExtractor(doc).extract(options);
    }
}
