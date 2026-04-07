/**
 * FlightDataExtractor - Extract CG, CP, Mass from OpenRocket flight data
 * 
 * This module parses the <flightdata>/<databranch> section of OpenRocket files
 * to extract simulation results at t=0 (initial conditions).
 * 
 * Based on Python reference implementation for reliable data extraction.
 */

import { ExtractedValue, FlightDataValues } from '../types';

/**
 * FlightData class - Parse and query flight data columns
 * 
 * Core principles:
 * 1. Strictly parse types string to build column name -> index mapping
 * 2. Validate each row has correct column count
 * 3. Do not assume units or column order
 * 4. Do not filter data - preserve original row indices
 */
export class FlightData {
    private types: string[] = [];
    private rows: number[][] = [];
    private index: Map<string, number> = new Map();
    private columnCache: Map<string, number[]> = new Map();
    private isValid: boolean = false;

    constructor(xmlRoot: Element) {
        try {
            // Use getElementsByTagName for xmldom compatibility
            const flightdataList = xmlRoot.getElementsByTagName('flightdata');
            if (flightdataList.length === 0) {
                console.warn('[FlightData] No <flightdata> element found');
                return;
            }
            const flightdata = flightdataList[0];

            const databranchList = flightdata.getElementsByTagName('databranch');
            if (databranchList.length === 0) {
                console.warn('[FlightData] No <databranch> element found');
                return;
            }
            const databranch = databranchList[0];

            // Parse types attribute to get column names
            const typesAttr = databranch.getAttribute('types');
            if (!typesAttr) {
                console.warn('[FlightData] databranch missing types attribute');
                return;
            }

            this.types = typesAttr.split(',').map(t => t.trim());

            // Build column name -> index mapping
            this.types.forEach((name, i) => {
                this.index.set(name, i);
            });

            console.log(`[FlightData] Found ${this.types.length} columns`);

            // Parse datapoints - use getElementsByTagName for compatibility
            const datapoints = databranch.getElementsByTagName('datapoint');
            const expectedColumnCount = this.types.length;

            let validRowCount = 0;
            let invalidRowCount = 0;

            for (const dp of Array.from(datapoints)) {
                if (!dp.textContent) {
                    invalidRowCount++;
                    continue;
                }

                const rowValues = dp.textContent.trim().split(',').map(v => {
                    const parsed = parseFloat(v.trim());
                    return isNaN(parsed) ? NaN : parsed;
                });

                // Strict validation: column count must match
                if (rowValues.length !== expectedColumnCount) {
                    invalidRowCount++;
                    continue;
                }

                this.rows.push(rowValues);
                validRowCount++;
            }

            console.log(`[FlightData] Parsed ${validRowCount} valid rows, skipped ${invalidRowCount}`);
            this.isValid = this.rows.length > 0;
        } catch (error) {
            console.error('[FlightData] Constructor error:', error);
            this.isValid = false;
        }
    }

    /**
     * Get all values for a column
     */
    column(name: string): number[] {
        if (!this.index.has(name)) {
            console.warn(`[FlightData] Column "${name}" not found`);
            return [];
        }

        if (this.columnCache.has(name)) {
            return this.columnCache.get(name)!;
        }

        const idx = this.index.get(name)!;
        const values = this.rows.map(row => row[idx]);
        this.columnCache.set(name, values);
        return values;
    }

    /**
     * Get value at a specific time (finds closest time point)
     */
    valueAtTime(name: string, targetTime: number = 0): number | null {
        const times = this.column('Time');
        const values = this.column(name);

        if (times.length === 0 || values.length === 0) return null;
        if (times.length !== values.length) return null;

        // Find closest time point
        let closestIndex = 0;
        let minDiff = Math.abs(times[0] - targetTime);

        for (let i = 1; i < times.length; i++) {
            const diff = Math.abs(times[i] - targetTime);
            if (diff < minDiff) {
                minDiff = diff;
                closestIndex = i;
            }
        }

        let result = values[closestIndex];

        // If closest is NaN, search for first valid value
        if (isNaN(result)) {
            for (let i = 0; i < values.length; i++) {
                if (!isNaN(values[i]) && isFinite(values[i])) {
                    result = values[i];
                    break;
                }
            }
        }

        return isNaN(result) || !isFinite(result) ? null : result;
    }

    hasColumn(name: string): boolean {
        return this.index.has(name);
    }

    getAvailableColumns(): string[] {
        return [...this.types];
    }

    getRowCount(): number {
        return this.rows.length;
    }

    isValidData(): boolean {
        return this.isValid;
    }

    /**
     * Find the earliest row where all requested columns are finite numbers.
     * Useful for extracting a self-consistent state vector (e.g. CG and CP from the same timestep).
     */
    findEarliestValidRow(columnNames: string[]): Record<string, number> | null {
        const indices = columnNames.map((name) => this.index.get(name));
        if (indices.some((idx) => idx === undefined)) {
            return null;
        }

        for (const row of this.rows) {
            let valid = true;
            const values: Record<string, number> = {};

            for (let i = 0; i < columnNames.length; i++) {
                const value = row[indices[i]!];
                if (!isFinite(value) || isNaN(value)) {
                    valid = false;
                    break;
                }
                values[columnNames[i]] = value;
            }

            if (valid) {
                return values;
            }
        }

        return null;
    }

    findBestStaticLikeRow(): Record<string, number> | null {
        const required = ['CG location', 'Stability margin calibers', 'Angle of attack', 'Mach number', 'Time'];
        const indices = required.map((name) => this.index.get(name));
        if (indices.some((idx) => idx === undefined)) {
            return null;
        }

        let best: Record<string, number> | null = null;
        let bestScore = Infinity;

        for (const row of this.rows) {
            const cg = row[indices[0]!];
            const stability = row[indices[1]!];
            const aoa = row[indices[2]!];
            const mach = row[indices[3]!];
            const time = row[indices[4]!];

            if (![cg, stability, aoa, mach, time].every((value) => isFinite(value) && !isNaN(value))) {
                continue;
            }

            // Prefer rows that best approximate OpenRocket's static stability display:
            // very low AoA, very low Mach, and near the start of flight.
            const score = Math.abs(aoa) + mach * 10 + time * 0.01;
            if (score < bestScore) {
                bestScore = score;
                best = {
                    'CG location': cg,
                    'Stability margin calibers': stability,
                    'Angle of attack': aoa,
                    'Mach number': mach,
                    'Time': time
                };
            }
        }

        return best;
    }

    /**
     * Extract CG and CP from DIFFERENT flight conditions to match OpenRocket's
     * design screen display:
     *
     * - CG: from launch (t≈0, full motor loaded) — OR shows static CG
     * - CP: from row nearest M≈0.3 — OR displays "at M=0.300"
     * - Stability: computed from (CP - CG) / refLength (not from a single row)
     *
     * This avoids the "single row" problem where CG at t=1.18s (motor partially
     * burned) doesn't match OR's displayed CG (which is at launch).
     */
    findDesignDisplayValues(): { cg: number | null; cp: number | null; stabilityFromRow: number | null } {
        // --- CG: from t≈0 (launch, full motor) ---
        const cgIdx = this.index.get('CG location');
        const timeIdx = this.index.get('Time');
        let launchCG: number | null = null;

        if (cgIdx !== undefined && timeIdx !== undefined) {
            // Find the first row where CG is valid (should be t=0 or very close)
            for (const row of this.rows) {
                const t = row[timeIdx];
                const cg = row[cgIdx];
                if (isFinite(cg) && !isNaN(cg) && cg > 0 && isFinite(t) && !isNaN(t)) {
                    launchCG = cg;
                    console.log(`[FlightData] Launch CG: ${(cg * 39.3701).toFixed(2)}in at t=${t.toFixed(3)}s`);
                    break;
                }
            }
        }

        // --- CP: from row nearest M≈0.3 ---
        const cpIdx = this.index.get('CP location');
        const machIdx = this.index.get('Mach number');
        const stabIdx = this.index.get('Stability margin calibers');
        let bestCP: number | null = null;
        let bestStability: number | null = null;
        let bestMachDist = Infinity;

        if (cpIdx !== undefined && machIdx !== undefined) {
            for (const row of this.rows) {
                const cp = row[cpIdx];
                const mach = row[machIdx];
                if (!isFinite(cp) || isNaN(cp) || cp <= 0) continue;
                if (!isFinite(mach) || isNaN(mach)) continue;

                const machDist = Math.abs(mach - 0.3);
                if (machDist < bestMachDist) {
                    bestMachDist = machDist;
                    bestCP = cp;
                    // Also grab stability from same row for reference
                    if (stabIdx !== undefined) {
                        const stab = row[stabIdx];
                        bestStability = (isFinite(stab) && !isNaN(stab)) ? stab : null;
                    }
                }
            }

            if (bestCP) {
                // Log actual Mach of the selected row by scanning again
                let actualMach = 0;
                for (const row of this.rows) {
                    const cp = row[cpIdx];
                    const mach = row[machIdx];
                    if (isFinite(cp) && cp > 0 && isFinite(mach) && Math.abs(mach - 0.3) === bestMachDist) {
                        actualMach = mach;
                        break;
                    }
                }
                console.log(`[FlightData] CP at M≈0.3: ${(bestCP * 39.3701).toFixed(2)}in (actual M=${actualMach.toFixed(3)})`);
            }
        }

        return { cg: launchCG, cp: bestCP, stabilityFromRow: bestStability };
    }
}

/**
 * FlightDataExtractor - Static methods for extracting values from simulations
 */
export class FlightDataExtractor {
    static getDefaultConfigId(doc: Document): string | null {
        const motorConfigs = Array.from(doc.getElementsByTagName('motorconfiguration'));
        const defaultConfig = motorConfigs.find((el) => el.getAttribute('default') === 'true');
        return defaultConfig?.getAttribute('configid') || null;
    }

    /**
     * Extract CG, CP, and Mass from a simulation element.
     *
     * Strategy (matches OpenRocket's design screen display):
     * - CG: from t≈0 (launch-pad, full motor) — OR shows static CG
     * - CP: from row nearest M≈0.3 — OR displays "at M=0.300"
     * - Stability: from the same M≈0.3 row (for reference), but the final
     *   stability shown to the user is recomputed from CG and CP
     * - Mass: from t=0 (launch-pad mass)
     */
    static extractFromSimulation(simulation: Element): FlightDataValues | null {
        try {
            const flightData = new FlightData(simulation);

            if (!flightData.isValidData()) {
                return null;
            }

            // Primary: use the split CG(t=0) + CP(M≈0.3) approach
            const designValues = flightData.findDesignDisplayValues();

            let cg = designValues.cg;
            let cp = designValues.cp;
            let stability = designValues.stabilityFromRow;

            // Fallback for CG: try valueAtTime(0)
            if (cg === null || cg <= 0) {
                cg = flightData.valueAtTime('CG location', 0);
            }

            // Fallback for CP: try findBestStaticLikeRow or earliest valid
            if (cp === null || cp <= 0) {
                const staticLike = flightData.findBestStaticLikeRow();
                if (staticLike) {
                    // Derive CP from CG + stability * refLength? No — just take CP column if available
                    // Use earliest valid row as last resort
                    const earliest = flightData.findEarliestValidRow(['CG location', 'CP location']);
                    cp = earliest?.['CP location'] ?? null;
                }
            }

            // Fallback for stability: try findBestStaticLikeRow
            if (stability === null) {
                const staticLike = flightData.findBestStaticLikeRow();
                stability = staticLike?.['Stability margin calibers'] ?? null;
            }

            // Mass: always from t=0 (launch-pad mass)
            const mass = flightData.valueAtTime('Mass', 0);

            const hasValidCG = cg !== null && cg > 0;
            const hasValidCP = cp !== null && cp > 0;
            const hasValidMass = mass !== null && mass > 0;
            const hasValidStability = stability !== null && stability > 0;

            if (!hasValidCG && !hasValidCP && !hasValidMass && !hasValidStability) {
                return null;
            }

            return {
                cg: hasValidCG ? { value: cg!, source: 'flightdata/launch-cg', confidence: 'high' } : null,
                cp: hasValidCP ? { value: cp!, source: 'flightdata/cp-at-mach03', confidence: 'high' } : null,
                mass: hasValidMass ? { value: mass!, source: 'flightdata/databranch', confidence: 'high' } : null,
                stability: hasValidStability ? { value: stability!, source: 'flightdata/mach03-row', confidence: 'medium' } : null
            };
        } catch (error) {
            console.error('[FlightDataExtractor] Error:', error);
            return null;
        }
    }

    /**
     * Extract values from all simulations in a document, selecting the best result
     */
    static extractFromDocument(doc: Document): FlightDataValues | null {
        // Use getElementsByTagName for xmldom compatibility
        const simulations = Array.from(doc.getElementsByTagName('simulation'));

        if (simulations.length === 0) {
            return null;
        }

        console.log(`[FlightDataExtractor] Found ${simulations.length} simulations`);
        const defaultConfigId = this.getDefaultConfigId(doc);
        if (defaultConfigId) {
            console.log(`[FlightDataExtractor] Default motor configuration: ${defaultConfigId}`);
        }

        const getSimulationConfigId = (simulation: Element): string | null => {
            const conditions = simulation.getElementsByTagName('conditions')[0];
            if (!conditions) return null;
            const configIdEl = conditions.getElementsByTagName('configid')[0];
            return configIdEl?.textContent?.trim() || null;
        };

        const hasAbortEvent = (simulation: Element): boolean => {
            const events = Array.from(simulation.getElementsByTagName('event'));
            return events.some((event) => event.getAttribute('type') === 'simabort');
        };

        const parseMetric = (simulation: Element, attrName: string): number => {
            const flightdata = simulation.getElementsByTagName('flightdata')[0];
            if (!flightdata) return 0;
            const raw = flightdata.getAttribute(attrName);
            const parsed = raw ? parseFloat(raw) : 0;
            return isFinite(parsed) ? parsed : 0;
        };

        const rankSimulation = (simulation: Element, extracted: FlightDataValues | null): number => {
            let score = 0;
            const status = simulation.getAttribute('status');
            if (status === 'uptodate') score += 40;
            if (status === 'external') score += 15;

            const configId = getSimulationConfigId(simulation);
            if (defaultConfigId && configId === defaultConfigId) score += 120;

            if (!hasAbortEvent(simulation)) score += 35;

            const maxAltitude = parseMetric(simulation, 'maxaltitude');
            const flightTime = parseMetric(simulation, 'flighttime');
            if (maxAltitude > 1) score += 20;
            if (flightTime > 1) score += 10;

            if (extracted?.mass?.value) score += 20;
            if (extracted?.cg?.value) score += 15;
            if (extracted?.cp?.value || extracted?.stability?.value) score += 15;

            return score;
        };

        const rankedCandidates = simulations
            .map((sim, idx) => {
                const result = this.extractFromSimulation(sim);
                const score = rankSimulation(sim, result);
                return { sim, idx, score, result };
            })
            .filter((candidate) => candidate.result !== null)
            .sort((a, b) => b.score - a.score || b.idx - a.idx);

        for (const { sim, idx, score } of rankedCandidates) {
            console.log(`[FlightDataExtractor] Checking simulation index=${idx}, score=${score}, status=${sim.getAttribute('status') || 'unknown'}, config=${getSimulationConfigId(sim) || 'n/a'}`);
        }

        if (rankedCandidates.length === 0) {
            return null;
        }

        const bestCandidate = rankedCandidates[0];
        console.log(
            `[FlightDataExtractor] ✅ Selected simulation index=${bestCandidate.idx}, status=${bestCandidate.sim.getAttribute('status') || 'unknown'}, config=${getSimulationConfigId(bestCandidate.sim) || 'n/a'}, score=${bestCandidate.score}`
        );

        return bestCandidate.result;
    }
}
