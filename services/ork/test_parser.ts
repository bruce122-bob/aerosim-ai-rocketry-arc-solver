/**
 * Test script for the new modular ORK parser
 * 
 * Run with: npx tsx services/ork/test_parser.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test the individual extractors
async function testExtractors() {
    console.log('='.repeat(60));
    console.log('🧪 Testing New Modular ORK Parser');
    console.log('='.repeat(60));

    // Read the First.ork file
    const orkPath = path.join(__dirname, '../../First.ork');

    if (!fs.existsSync(orkPath)) {
        console.error('❌ First.ork not found at:', orkPath);
        return;
    }

    console.log('📁 Found test file:', orkPath);
    const fileBuffer = fs.readFileSync(orkPath);
    console.log('📏 File size:', fileBuffer.length, 'bytes');

    // Test 1: ZipExtractor
    console.log('\n' + '-'.repeat(40));
    console.log('Test 1: ZipExtractor');
    console.log('-'.repeat(40));

    const { extractXmlFromZip, isZipFile } = await import('./ZipExtractor');

    const uint8Array = new Uint8Array(fileBuffer);
    const isZip = isZipFile(uint8Array);
    console.log('Is ZIP format:', isZip ? '✅ Yes' : '❌ No');

    if (!isZip) {
        console.error('❌ File is not a ZIP archive');
        return;
    }

    const extractResult = await extractXmlFromZip(fileBuffer.buffer.slice(
        fileBuffer.byteOffset,
        fileBuffer.byteOffset + fileBuffer.byteLength
    ));
    console.log('✅ Extracted XML from:', extractResult.sourceFile);
    console.log('   XML length:', extractResult.xml.length, 'characters');
    console.log('   Files in archive:', extractResult.allFiles.join(', '));

    // Test 2: XmlParser
    console.log('\n' + '-'.repeat(40));
    console.log('Test 2: XmlParser');
    console.log('-'.repeat(40));

    const { parseXml, findRocketElement } = await import('./XmlParser');

    const parseResult = await parseXml(extractResult.xml);

    if (parseResult.success === false) {
        console.error('❌ XML parsing failed:', parseResult.error.message);
        return;
    }

    console.log('✅ XML parsed successfully');

    const rocketElement = findRocketElement(parseResult.document);
    console.log('   Rocket element found:', rocketElement ? '✅ Yes' : '❌ No');

    if (rocketElement) {
        const nameElements = rocketElement.getElementsByTagName('name');
        const rocketName = nameElements.length > 0 ? nameElements[0].textContent : null;
        console.log('   Rocket name:', rocketName || '(no name)');
    }

    // Test 3: FlightDataExtractor
    console.log('\n' + '-'.repeat(40));
    console.log('Test 3: FlightDataExtractor');
    console.log('-'.repeat(40));

    const { FlightDataExtractor } = await import('./extractors/FlightDataExtractor');

    const flightData = FlightDataExtractor.extractFromDocument(parseResult.document);

    if (flightData) {
        if (flightData.cg) {
            console.log(`✅ CG: ${flightData.cg.value.toFixed(5)} m (${(flightData.cg.value * 39.3701).toFixed(3)} in)`);
            console.log(`   Source: ${flightData.cg.source}`);
        } else {
            console.log('⚠️ CG: Not found');
        }

        if (flightData.cp) {
            console.log(`✅ CP: ${flightData.cp.value.toFixed(5)} m (${(flightData.cp.value * 39.3701).toFixed(3)} in)`);
            console.log(`   Source: ${flightData.cp.source}`);
        } else {
            console.log('⚠️ CP: Not found');
        }

        if (flightData.mass) {
            console.log(`✅ Mass: ${(flightData.mass.value * 1000).toFixed(1)} g`);
            console.log(`   Source: ${flightData.mass.source}`);
        } else {
            console.log('⚠️ Mass: Not found');
        }
    } else {
        console.log('⚠️ No flight data found in simulations');
    }

    // Test 4: CdExtractor
    console.log('\n' + '-'.repeat(40));
    console.log('Test 4: CdExtractor');
    console.log('-'.repeat(40));

    const { CdExtractor } = await import('./extractors/CdExtractor');

    const cdResult = CdExtractor.extract(parseResult.document);
    console.log(`✅ Cd: ${cdResult.value.toFixed(4)}`);
    console.log(`   Source: ${cdResult.source}`);
    console.log(`   Priority: ${cdResult.priority}`);

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Test Summary');
    console.log('='.repeat(60));
    console.log('✅ ZipExtractor: Working');
    console.log('✅ XmlParser: Working');
    console.log(flightData?.cg ? '✅' : '⚠️', 'FlightDataExtractor (CG):', flightData?.cg ? 'Working' : 'No data');
    console.log(flightData?.cp ? '✅' : '⚠️', 'FlightDataExtractor (CP):', flightData?.cp ? 'Working' : 'No data');
    console.log(flightData?.mass ? '✅' : '⚠️', 'FlightDataExtractor (Mass):', flightData?.mass ? 'Working' : 'No data');
    console.log('✅ CdExtractor: Working');
    console.log('='.repeat(60));
}

testExtractors().catch(console.error);
