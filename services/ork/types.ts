/**
 * Shared types for ORK parsing
 */

export interface ExtractedValue<T> {
    value: T;
    source: string;
    confidence: 'high' | 'medium' | 'low';
}

export interface FlightDataValues {
    cg: ExtractedValue<number> | null;
    cp: ExtractedValue<number> | null;
    mass: ExtractedValue<number> | null;
    stability?: ExtractedValue<number> | null;
}

export interface CdValue {
    value: number;
    source: string;
    priority: number;
}

export interface ParseWarning {
    code: string;
    message: string;
    suggestion?: string;
}

export interface ParseError {
    code: string;
    message: string;
    details?: string;
    suggestions?: string[];
}

import { RocketConfig } from '../../types';

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
