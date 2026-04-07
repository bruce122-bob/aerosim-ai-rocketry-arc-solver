import { MotorData } from '../types';
import { MOTOR_DATABASE } from '../data/motorDatabase';

/**
 * Normalize motor name for matching
 * Handles various naming formats: "F42-8T", "F42T-8", "F42T" → "F42T"
 */
const normalizeMotorName = (name: string): string => {
  let normalized = name
    .toUpperCase()
    .replace(/AEROTECH|ESTES|CESARONI|APOGEE|QUEST/gi, '') // Remove manufacturer
    .replace(/\s+/g, '') // Remove spaces
    .replace(/[^A-Z0-9]/g, '') // Remove separators like '-', '_', '/', spaces, etc.
    .trim();
  
  // Handle special cases where delay is embedded after motor code
  // "F428T" → "F42T" (remove middle digit that's the delay)
  // "F3210T" → "F32T"
  normalized = normalized
    .replace(/([A-Z])(\d{2,3})(\d)([A-Z])$/, '$1$2$4') // F428T → F42T, F3210T → F32T
    .replace(/([A-Z])(\d{1,2})T(\d+)$/, '$1$2T'); // F42T8 → F42T
  
  return normalized;
};

/**
 * Extract delay time from motor designation (e.g., "F42-8T" → 8)
 */
const extractDelayTime = (motorName: string): number | undefined => {
  // Only parse explicit delay suffixes like "F42-8T", "F42T-8", or "F42-8".
  // Do not treat the thrust code in plain names like "F32T" as a delay.
  const delayMatch = motorName.match(/-(\d+)[T]?$/i) || motorName.match(/[A-Z]-(\d+)$/i);
  if (delayMatch) {
    return parseInt(delayMatch[1], 10);
  }
  return undefined;
};

/**
 * Find motor in database by designation (e.g., "F42-8T", "F39-6T", "F51-6T")
 * Returns the matched motor with delay time applied if found
 */
export const findMotorByDesignation = (designation: string): MotorData | null => {
  if (!designation) return null;

  const normalizedDesignation = normalizeMotorName(designation);
  const delayTime = extractDelayTime(designation);

  // Try exact match first
  let dbMotor = MOTOR_DATABASE.find(m => {
    const normalizedDbName = normalizeMotorName(m.name);
    return normalizedDbName === normalizedDesignation;
  });

  // Try fuzzy match (allow for slight variations)
  if (!dbMotor) {
    // Extract just the class and thrust code (e.g., "F42T" or "F42")
    const corePattern = normalizedDesignation.match(/([A-M]\d{1,3}[A-Z]?)/i);
    if (corePattern) {
      const core = corePattern[1];
      // First try exact core match
      dbMotor = MOTOR_DATABASE.find(m => {
        const normalizedDbName = normalizeMotorName(m.name);
        return normalizedDbName === core || normalizedDbName.startsWith(core);
      });
      
      // If not found, try partial match (e.g., "F51" matches "F51WT")
      if (!dbMotor) {
        const baseCode = core.match(/([A-Z]\d{1,3})/)?.[1]; // Extract "F51" from "F51T"
        if (baseCode) {
          dbMotor = MOTOR_DATABASE.find(m => {
            const normalizedDbName = normalizeMotorName(m.name);
            return normalizedDbName.startsWith(baseCode) || baseCode === normalizedDbName.substring(0, baseCode.length);
          });
        }
      }
    }
  }

  // Last resort: try original partial match
  if (!dbMotor) {
    const motorCore = designation.split('-')[0].toUpperCase();
    // Extract base motor code (e.g., "F51" from "F51-6T")
    const baseCode = motorCore.match(/([A-Z]\d{1,3})/)?.[1];
    if (baseCode) {
      dbMotor = MOTOR_DATABASE.find(m => {
        const normalizedDbName = normalizeMotorName(m.name);
        // Match if database name contains the base code (e.g., "F51WT" contains "F51")
        return normalizedDbName.includes(baseCode) || baseCode.includes(normalizedDbName.substring(0, baseCode.length));
      });
    }
  }

  if (!dbMotor) {
    console.warn(`[MOTOR MATCHER] Could not find motor for designation: ${designation}`);
    return null;
  }

  // Create a copy of the motor with delay time applied
  const matchedMotor: MotorData = {
    ...dbMotor,
    delayTime: delayTime !== undefined ? delayTime : dbMotor.delayTime
  };

  console.log(`[MOTOR MATCHER] Matched "${designation}" → "${dbMotor.name}"${delayTime !== undefined ? ` (delay: ${delayTime}s)` : ''}`);
  
  return matchedMotor;
};








