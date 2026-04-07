/**
 * Unit Tests for ORK Parser
 * 
 * Tests the accuracy and robustness of .ork file parsing,
 * focusing on CG/CP/Mass extraction and format compatibility.
 * 
 * Run with: npx tsx tests/orkParser.test.ts
 */

import { parseORKFile } from '../services/ork';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ES module compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test result interface
interface TestResult {
    name: string;
    passed: boolean;
    error?: string;
    details?: any;
}

// Test results
const results: TestResult[] = [];

/**
 * Helper to create a File object from buffer (for browser File API compatibility)
 */
function createFileFromBuffer(buffer: Buffer, filename: string): File {
    // In Node.js environment, we need to simulate File object
    // This is a simplified version - in actual browser environment, File is native
    const blob = new Blob([buffer], { type: 'application/zip' });
    return Object.assign(blob, {
        name: filename,
        lastModified: Date.now()
    }) as File;
}

/**
 * Test 1: Parse First.ork file
 */
async function testParseFirstOrk(): Promise<TestResult> {
    const testName = 'Parse First.ork file';
    
    try {
        const orkPath = path.join(__dirname, '../First.ork');
        
        if (!fs.existsSync(orkPath)) {
            return {
                name: testName,
                passed: false,
                error: `Test file not found: ${orkPath}`
            };
        }

        const fileBuffer = fs.readFileSync(orkPath);
        const file = createFileFromBuffer(fileBuffer, 'First.ork');
        
        const result = await parseORKFile(file);

        if (!result.success || !result.rocket) {
            return {
                name: testName,
                passed: false,
                error: result.error || 'Parsing failed without error message',
                details: result
            };
        }

        const { rocket } = result;

        // Validate basic properties
        const validations = {
            hasName: !!rocket.name,
            hasStages: Array.isArray(rocket.stages) && rocket.stages.length > 0,
            hasMotor: !!rocket.motor,
            hasCd: typeof rocket.cdOverride === 'number' && rocket.cdOverride > 0
        };

        const allValid = Object.values(validations).every(v => v);

        return {
            name: testName,
            passed: allValid,
            error: allValid ? undefined : 'Validation failed',
            details: {
                rocketName: rocket.name,
                stagesCount: rocket.stages.length,
                motorName: rocket.motor?.name,
                cdValue: rocket.cdOverride,
                validations
            }
        };

    } catch (error) {
        return {
            name: testName,
            passed: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            details: error
        };
    }
}

/**
 * Test 2: CG/CP/Mass extraction accuracy
 */
async function testExtractCGCPMass(): Promise<TestResult> {
    const testName = 'CG/CP/Mass extraction';
    
    try {
        const orkPath = path.join(__dirname, '../First.ork');
        
        if (!fs.existsSync(orkPath)) {
            return {
                name: testName,
                passed: false,
                error: `Test file not found: ${orkPath}`
            };
        }

        const fileBuffer = fs.readFileSync(orkPath);
        const file = createFileFromBuffer(fileBuffer, 'First.ork');
        
        const result = await parseORKFile(file);

        if (!result.success || !result.rocket) {
            return {
                name: testName,
                passed: false,
                error: 'Parsing failed'
            };
        }

        const { rocket } = result;
        const simSettings = rocket.simulationSettings;

        // Validate extracted values
        const validations = {
            hasCG: simSettings?.cg !== undefined && simSettings.cg > 0,
            hasCP: simSettings?.cp !== undefined && simSettings.cp > 0,
            hasMass: simSettings?.mass !== undefined && simSettings.mass > 0,
            cgValid: simSettings?.cg ? simSettings.cg > 0 && simSettings.cg < 10 : false, // Reasonable range (0-10m)
            cpValid: simSettings?.cp ? simSettings.cp > 0 && simSettings.cp < 10 : false, // Reasonable range
            cpGreaterThanCG: simSettings?.cp && simSettings?.cg ? simSettings.cp > simSettings.cg : false // CP should be aft of CG for stability
        };

        const allValid = Object.values(validations).every(v => v);

        return {
            name: testName,
            passed: allValid,
            error: allValid ? undefined : 'CG/CP/Mass extraction validation failed',
            details: {
                cg: simSettings?.cg,
                cp: simSettings?.cp,
                mass: simSettings?.mass,
                validations
            }
        };

    } catch (error) {
        return {
            name: testName,
            passed: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Test 3: ZIP format detection
 */
async function testZipFormatDetection(): Promise<TestResult> {
    const testName = 'ZIP format detection';
    
    try {
        const orkPath = path.join(__dirname, '../First.ork');
        
        if (!fs.existsSync(orkPath)) {
            return {
                name: testName,
                passed: false,
                error: `Test file not found: ${orkPath}`
            };
        }

        const fileBuffer = fs.readFileSync(orkPath);
        
        // Check ZIP signature (PK header)
        const isZip = fileBuffer[0] === 0x50 && fileBuffer[1] === 0x4B; // 'PK'
        
        const file = createFileFromBuffer(fileBuffer, 'First.ork');
        const result = await parseORKFile(file);

        // If file has ZIP signature, parsing should succeed
        const passed = isZip ? result.success : true; // Non-ZIP files might be old format

        return {
            name: testName,
            passed,
            error: passed ? undefined : 'ZIP format detection or parsing failed',
            details: {
                isZip,
                parseSuccess: result.success
            }
        };

    } catch (error) {
        return {
            name: testName,
            passed: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Test 4: Error handling for invalid file
 */
async function testErrorHandling(): Promise<TestResult> {
    const testName = 'Error handling for invalid file';
    
    try {
        // Create an invalid file (empty buffer)
        const invalidBuffer = Buffer.from('invalid content');
        const file = createFileFromBuffer(invalidBuffer, 'invalid.ork');
        
        const result = await parseORKFile(file);

        // Should handle error gracefully
        const passed = !result.success && !!result.error;

        return {
            name: testName,
            passed,
            error: passed ? undefined : 'Error handling failed - should return error for invalid file',
            details: {
                success: result.success,
                hasError: !!result.error,
                errorMessage: result.error
            }
        };

    } catch (error) {
        // Exception is acceptable for invalid files
        return {
            name: testName,
            passed: true,
            details: {
                exceptionCaught: true,
                errorType: error instanceof Error ? error.constructor.name : 'Unknown'
            }
        };
    }
}

/**
 * Test 5: Cd extraction
 */
async function testCdExtraction(): Promise<TestResult> {
    const testName = 'Cd (drag coefficient) extraction';
    
    try {
        const orkPath = path.join(__dirname, '../First.ork');
        
        if (!fs.existsSync(orkPath)) {
            return {
                name: testName,
                passed: false,
                error: `Test file not found: ${orkPath}`
            };
        }

        const fileBuffer = fs.readFileSync(orkPath);
        const file = createFileFromBuffer(fileBuffer, 'First.ork');
        
        const result = await parseORKFile(file);

        if (!result.success || !result.rocket) {
            return {
                name: testName,
                passed: false,
                error: 'Parsing failed'
            };
        }

        const cd = result.rocket.cdOverride;

        // Validate Cd value (should be positive and reasonable for rockets: 0.1-2.0)
        const passed = typeof cd === 'number' && cd > 0 && cd < 2.0;

        return {
            name: testName,
            passed,
            error: passed ? undefined : `Invalid Cd value: ${cd}`,
            details: {
                cdValue: cd,
                isValid: cd > 0 && cd < 2.0
            }
        };

    } catch (error) {
        return {
            name: testName,
            passed: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

/**
 * Run all tests
 */
async function runAllTests() {
    console.log('='.repeat(60));
    console.log('🧪 ORK Parser Unit Tests');
    console.log('='.repeat(60));
    console.log('');

    // Run tests
    results.push(await testParseFirstOrk());
    results.push(await testExtractCGCPMass());
    results.push(await testZipFormatDetection());
    results.push(await testErrorHandling());
    results.push(await testCdExtraction());

    // Print results
    console.log('Test Results:');
    console.log('-'.repeat(60));

    let passCount = 0;
    let failCount = 0;

    results.forEach((result, index) => {
        const status = result.passed ? '✅ PASS' : '❌ FAIL';
        console.log(`${index + 1}. ${status} - ${result.name}`);
        
        if (!result.passed && result.error) {
            console.log(`   Error: ${result.error}`);
        }
        
        if (result.details) {
            console.log(`   Details:`, JSON.stringify(result.details, null, 2));
        }
        
        console.log('');

        if (result.passed) {
            passCount++;
        } else {
            failCount++;
        }
    });

    console.log('='.repeat(60));
    console.log(`Summary: ${passCount} passed, ${failCount} failed (${results.length} total)`);
    console.log('='.repeat(60));

    // Exit with appropriate code
    process.exit(failCount > 0 ? 1 : 0);
}

// Run tests if executed directly (ES module compatible)
// In ES modules, we can check if this file is being run directly
if (import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/')) || 
    process.argv[1]?.includes('orkParser.test.ts')) {
    runAllTests().catch(error => {
        console.error('Test execution failed:', error);
        process.exit(1);
    });
}

export { runAllTests, testParseFirstOrk, testExtractCGCPMass, testCdExtraction };
