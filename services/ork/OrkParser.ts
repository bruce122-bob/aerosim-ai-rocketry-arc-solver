/**
 * OrkParser - Main orchestrator for parsing OpenRocket .ork files
 * 
 * This module coordinates the parsing process using dedicated extractors
 * for each data type (CG, CP, Cd, components, etc.)
 * 
 * Architecture:
 * - ZipExtractor: Extracts XML from ZIP archives
 * - XmlParser: Parses XML with error handling
 * - FlightDataExtractor: Extracts CG/CP/Mass from simulation data
 * - CdExtractor: Extracts Cd with priority-based resolution
 * 
 * The component parsing still delegates to the legacy orkParser for now
 * to minimize risk during the refactoring process.
 */

import { RocketConfig } from '../../types';
import { extractXmlFromZip, isZipFile } from './ZipExtractor';
import { parseXml, findRocketElement } from './XmlParser';
import { FlightDataExtractor } from './extractors/FlightDataExtractor';
import { CdExtractor } from './extractors/CdExtractor';
import { ParseError, ParseWarning } from './types';
import { calculateCP, resolveStabilityReferenceLength } from '../stability';
import { parseLegacyORKFile } from '../orkParser';

export interface ORKParseResult {
    success: boolean;
    rocket?: RocketConfig;
    error?: string;
    warnings?: string[];
    parseStats?: {
        totalComponents: number;
        totalStages: number;
        hasMotor: boolean;
        hasParachute: boolean;
        hasCG: boolean;
        hasCP: boolean;
        hasReferenceLength: boolean;
        validationErrors: number;
        validationWarnings: number;
    };
}

/**
 * Parse an OpenRocket .ork file
 * 
 * This is the main entry point for parsing .ork files using the new modular architecture.
 * 
 * For now, it delegates to the legacy parser but uses new extractors for CG/CP/Cd.
 */
export async function parseORKFile(file: File): Promise<ORKParseResult> {
    const warnings: string[] = [];

    try {
        console.log('[OrkParser] Starting parse:', file.name);

        // Step 1: Read file content
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        console.log('[OrkParser] File size:', arrayBuffer.byteLength, 'bytes');

        // Step 2: Extract XML content
        let xmlContent: string;

        if (isZipFile(uint8Array)) {
            console.log('[OrkParser] Detected ZIP format, extracting...');
            const extractResult = await extractXmlFromZip(arrayBuffer);
            xmlContent = extractResult.xml;
            console.log('[OrkParser] Extracted from:', extractResult.sourceFile);
        } else {
            // Plain XML format (older OpenRocket versions)
            const decoder = new TextDecoder('utf-8');
            xmlContent = decoder.decode(uint8Array);
            console.log('[OrkParser] Plain XML format detected');
        }

        // Step 3: Parse XML
        const parseResult = await parseXml(xmlContent);

        if (parseResult.success === false) {
            return {
                success: false,
                error: formatParseError(parseResult.error)
            };
        }

        const doc = parseResult.document;

        // Step 4: Find rocket element
        const rocketElement = findRocketElement(doc);
        if (!rocketElement) {
            return {
                success: false,
                error: 'No rocket definition found in file. Please ensure this is an .ork file saved by OpenRocket.'
            };
        }

        // Step 5: Use new extractors for CG/CP/Cd
        console.log('[OrkParser] Using new modular extractors...');

        // Extract flight data (CG/CP/Mass)
        const flightData = FlightDataExtractor.extractFromDocument(doc);
        if (flightData) {
            if (flightData.cg) {
                console.log(`[OrkParser] ✅ CG: ${flightData.cg.value.toFixed(5)}m from ${flightData.cg.source}`);
            }
            if (flightData.cp) {
                console.log(`[OrkParser] ✅ CP: ${flightData.cp.value.toFixed(5)}m from ${flightData.cp.source}`);
            }
            if (flightData.mass) {
                console.log(`[OrkParser] ✅ Mass: ${(flightData.mass.value * 1000).toFixed(1)}g from ${flightData.mass.source}`);
            }
        }

        // Extract Cd
        const cdResult = CdExtractor.extract(doc);
        console.log(`[OrkParser] ✅ Cd: ${cdResult.value.toFixed(4)} from ${cdResult.source}`);

        // Step 6: Delegate to legacy parser for components
        // This allows gradual migration while maintaining compatibility
        console.log('[OrkParser] Delegating component parsing to legacy parser...');

        const legacyResult = await parseLegacyORKFile(file);

        if (!legacyResult.success || !legacyResult.rocket) {
            return legacyResult;
        }

        // Step 7: Merge new extractor results with legacy results
        const rocket = legacyResult.rocket;

        // --- CG Priority ---
        // 1. Flight data CG from representative state (M≈0.3) — matches OR display exactly
        // 2. Legacy parser CG (stage overrides + motor adjustment) — good for files without flight data
        const legacyCg = rocket.simulationSettings?.cg;
        if (flightData?.cg && flightData.cg.value > 0) {
            if (!rocket.simulationSettings) rocket.simulationSettings = {};
            rocket.simulationSettings.cg = flightData.cg.value;
            console.log(`[OrkParser] ✅ CG from flight data (representative state): ${flightData.cg.value.toFixed(5)}m = ${(flightData.cg.value/0.0254).toFixed(2)}in`);
            if (legacyCg && legacyCg > 0) {
                console.log(`[OrkParser]    (legacy CG for reference: ${legacyCg.toFixed(5)}m = ${(legacyCg/0.0254).toFixed(2)}in)`);
            }
        } else if (legacyCg && legacyCg > 0) {
            console.log(`[OrkParser] ✅ CG from legacy parser: ${legacyCg.toFixed(5)}m = ${(legacyCg/0.0254).toFixed(2)}in (no flight data)`);
        }

        if (flightData?.mass) {
            if (!rocket.simulationSettings) rocket.simulationSettings = {};
            rocket.simulationSettings.mass = flightData.mass.value;
        }
        if (flightData?.stability) {
            if (!rocket.stability) rocket.stability = {};
            rocket.stability.margin = flightData.stability.value;
            console.log(`[OrkParser] ✅ Stability margin from flight data: ${flightData.stability.value.toFixed(3)} cal`);
        }

        // --- CP Priority ---
        // 1. Flight data CP from representative state (M≈0.3) — directly from OR simulation, most accurate
        // 2. Barrowman geometry CP — good fallback for files without flight data
        // 3. Derived CP from stability margin + CG + reference length — last resort
        const staticCp = calculateCP(rocket.stages);
        const currentCg = rocket.simulationSettings?.cg;
        const refLength = resolveStabilityReferenceLength(
            rocket.stages,
            rocket.simulationSettings?.referenceLength
        );
        const cpFromStability = (
            flightData?.stability &&
            currentCg !== undefined &&
            currentCg > 0 &&
            refLength > 0
        )
            ? currentCg + flightData.stability.value * refLength
            : null;

        if (flightData?.cp && flightData.cp.value > 0) {
            // Best: directly from OR simulation at M≈0.3
            if (!rocket.simulationSettings) rocket.simulationSettings = {};
            rocket.simulationSettings.cp = flightData.cp.value;
            console.log(`[OrkParser] ✅ CP from flight data (representative state): ${flightData.cp.value.toFixed(5)}m = ${(flightData.cp.value/0.0254).toFixed(2)}in`);
            if (staticCp > 0) {
                console.log(`[OrkParser]    (Barrowman CP for reference: ${staticCp.toFixed(5)}m = ${(staticCp/0.0254).toFixed(2)}in)`);
            }
        } else if (staticCp > 0) {
            // Good fallback: Barrowman geometry
            if (!rocket.simulationSettings) rocket.simulationSettings = {};
            rocket.simulationSettings.cp = staticCp;
            console.log(`[OrkParser] ✅ CP from Barrowman geometry: ${staticCp.toFixed(5)}m = ${(staticCp/0.0254).toFixed(2)}in`);
        } else if (cpFromStability && cpFromStability > 0) {
            // Last resort: derived from stability margin
            if (!rocket.simulationSettings) rocket.simulationSettings = {};
            rocket.simulationSettings.cp = cpFromStability;
            console.log(`[OrkParser] ✅ CP derived from stability margin: ${cpFromStability.toFixed(5)}m = ${(cpFromStability/0.0254).toFixed(2)}in`);
        }

        // Use new Cd extractor result
        rocket.cdOverride = cdResult.value;

        // Add any warnings from new extractors
        if (legacyResult.warnings) {
            warnings.push(...legacyResult.warnings);
        }

        return {
            success: true,
            rocket,
            warnings: warnings.length > 0 ? warnings : undefined,
            parseStats: legacyResult.parseStats
        };

    } catch (error) {
        console.error('[OrkParser] Parse error:', error);

        return {
            success: false,
            error: formatError(error)
        };
    }
}

/**
 * Format a ParseError into a user-friendly string
 */
function formatParseError(error: ParseError): string {
    let message = error.message;

    if (error.details) {
        message += `\n\nError details: ${error.details}`;
    }

    if (error.suggestions && error.suggestions.length > 0) {
        message += '\n\nSuggestions:\n' + error.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n');
    }

    return message;
}

/**
 * Format a generic error into a user-friendly string
 */
function formatError(error: unknown): string {
    const baseMessage = error instanceof Error ? error.message : 'Unknown error';

    const suggestions = [
        'Verify the file is an .ork format saved by OpenRocket',
        'Ensure the file is not corrupted',
        'Save with OpenRocket 1.0 or later',
        'Try opening the file in OpenRocket to verify its integrity'
    ];

    return `${baseMessage}\n\nSuggestions:\n${suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
}
