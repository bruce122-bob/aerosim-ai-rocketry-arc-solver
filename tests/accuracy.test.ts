/**
 * Accuracy Test — Compare parsed CG/CP/Stability against OpenRocket reference values
 *
 * Run with: npx tsx tests/accuracy.test.ts
 *
 * Known reference values from OpenRocket:
 * - test.ork:                  CG=14.26in, CP=18.434in, Stability=?
 * - Final rocket design 2.ork: CG=18.757in, CP=24.709in, Stability=2.29cal
 * - First.ork:                 CG=?, CP=?, Stability=? (need to get from OR)
 */

import { parseORKFile } from '../services/ork';
import { calculateStability, calculateCG, calculateCP, resolveStabilityReferenceLength } from '../services/stability';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function createFileFromBuffer(buffer: Buffer, filename: string): File {
    const blob = new Blob([buffer], { type: 'application/zip' });
    return Object.assign(blob, {
        name: filename,
        lastModified: Date.now()
    }) as File;
}

const M_TO_IN = 39.3701;

interface ReferenceValues {
    cgIn?: number;   // CG in inches from tip
    cpIn?: number;   // CP in inches from tip
    stabilityCal?: number;  // Stability margin in calibers
}

interface TestFile {
    filename: string;
    reference: ReferenceValues;
}

const TEST_FILES: TestFile[] = [
    {
        filename: 'test.ork',
        reference: { cgIn: 14.26, cpIn: 18.434 }
    },
    {
        filename: 'Final rocket design 2.ork',
        reference: { cgIn: 18.757, cpIn: 24.709, stabilityCal: 2.29 }
    },
    {
        filename: 'First.ork',
        reference: {} // Need OR values — will just report parsed values
    }
];

async function testFile(tf: TestFile) {
    const filePath = path.join(__dirname, '../public', tf.filename);
    if (!fs.existsSync(filePath)) {
        console.log(`  ⚠️  File not found: ${filePath}`);
        return;
    }

    const buffer = fs.readFileSync(filePath);
    const file = createFileFromBuffer(buffer, tf.filename);
    const result = await parseORKFile(file);

    if (!result.success || !result.rocket) {
        console.log(`  ❌ Parse failed: ${result.error}`);
        return;
    }

    const rocket = result.rocket;
    const sim = rocket.simulationSettings || {};

    // Also compute Barrowman values for comparison
    const barrowmanCp = calculateCP(rocket.stages);
    const barrowmanCg = calculateCG(rocket.stages);
    const refLength = resolveStabilityReferenceLength(rocket.stages, sim.referenceLength);

    const cgIn = sim.cg ? sim.cg * M_TO_IN : null;
    const cpIn = sim.cp ? sim.cp * M_TO_IN : null;
    const stabMargin = (sim.cp && sim.cg && refLength > 0) ? (sim.cp - sim.cg) / refLength : null;

    console.log(`  Final CG:  ${cgIn?.toFixed(2) ?? '?'} in   (${sim.cg?.toFixed(5) ?? '?'} m)`);
    console.log(`  Final CP:  ${cpIn?.toFixed(2) ?? '?'} in   (${sim.cp?.toFixed(5) ?? '?'} m)`);
    console.log(`  Stability: ${stabMargin?.toFixed(2) ?? '?'} cal`);
    console.log(`  Mass:      ${sim.mass ? (sim.mass * 1000).toFixed(1) : '?'} g`);
    console.log(`  Cd:        ${rocket.cdOverride?.toFixed(4) ?? '?'}`);
    console.log(`  RefLen:    ${refLength ? (refLength * M_TO_IN).toFixed(3) : '?'} in`);
    console.log('');
    console.log(`  Barrowman CG: ${(barrowmanCg * M_TO_IN).toFixed(2)} in   (no motor)`);
    console.log(`  Barrowman CP: ${(barrowmanCp * M_TO_IN).toFixed(2)} in`);

    // Compare with reference
    const ref = tf.reference;
    if (ref.cgIn || ref.cpIn || ref.stabilityCal) {
        console.log('');
        console.log('  --- Accuracy vs OpenRocket ---');
        if (ref.cgIn && cgIn) {
            const err = Math.abs(cgIn - ref.cgIn);
            const pct = (err / ref.cgIn * 100).toFixed(1);
            const icon = err < 0.1 ? '✅' : err < 0.5 ? '🟡' : '❌';
            console.log(`  ${icon} CG error: ${err.toFixed(3)} in (${pct}%)  [got ${cgIn.toFixed(2)}, target ${ref.cgIn}]`);
        }
        if (ref.cpIn && cpIn) {
            const err = Math.abs(cpIn - ref.cpIn);
            const pct = (err / ref.cpIn * 100).toFixed(1);
            const icon = err < 0.1 ? '✅' : err < 0.5 ? '🟡' : '❌';
            console.log(`  ${icon} CP error: ${err.toFixed(3)} in (${pct}%)  [got ${cpIn.toFixed(2)}, target ${ref.cpIn}]`);
        }
        if (ref.stabilityCal && stabMargin) {
            const err = Math.abs(stabMargin - ref.stabilityCal);
            const icon = err < 0.05 ? '✅' : err < 0.2 ? '🟡' : '❌';
            console.log(`  ${icon} Stability error: ${err.toFixed(3)} cal  [got ${stabMargin.toFixed(2)}, target ${ref.stabilityCal}]`);
        }
    }
}

async function main() {
    console.log('='.repeat(70));
    console.log('🎯 ORK Parser Accuracy Test — CG/CP/Stability vs OpenRocket');
    console.log('='.repeat(70));
    console.log('');

    for (const tf of TEST_FILES) {
        console.log(`📄 ${tf.filename}`);
        console.log('-'.repeat(50));
        await testFile(tf);
        console.log('');
    }

    console.log('='.repeat(70));
    console.log('Done.');
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
