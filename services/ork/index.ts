/**
 * ORK Parser - Public API
 * 
 * This module provides the public interface for parsing OpenRocket .ork files.
 * The implementation is split into focused extractors for maintainability.
 */

export { parseORKFile } from './OrkParser';
export type { ORKParseResult } from './types';
export { FlightDataExtractor, FlightData } from './extractors/FlightDataExtractor';
export { CdExtractor } from './extractors/CdExtractor';
export * from './types';

