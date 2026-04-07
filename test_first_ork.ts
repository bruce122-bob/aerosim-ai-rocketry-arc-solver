import { parseORKFile } from './services/ork';
import { calculateDryMass } from './services/rocketUtils';
import * as fs from 'fs';

async function testFirstOrk() {
  console.log('='.repeat(60));
  console.log('Testing First.ork parsing with New Modular Parser...');
  console.log('='.repeat(60));

  const orkPath = './First.ork';
  const fileBuffer = fs.readFileSync(orkPath);
  const file = new File([fileBuffer], 'First.ork', { type: 'application/zip' });

  try {
    const result = await parseORKFile(file);

    if (!result.success || !result.rocket) {
      console.error('Parsing failed:', result.error);
      return;
    }

    const { rocket } = result;
    const dryMass = calculateDryMass(rocket.stages);

    console.log('\n' + '='.repeat(60));
    console.log('PARSING RESULTS:');
    console.log('='.repeat(60));
    console.log(`Rocket Name: ${rocket.name}`);
    console.log(`Dry Mass (Calculated): ${(dryMass * 1000).toFixed(1)}g`);
    console.log(`Extracted Mass (from Simulation): ${(rocket.simulationSettings?.mass !== undefined ? rocket.simulationSettings.mass * 1000 : 0).toFixed(1)}g`);
    console.log(`Expected: 348g (Calculated) / ~424g (Full)`);
    console.log(`\nCd: ${rocket.cdOverride}`);
    const refArea = rocket.simulationSettings?.referenceLength || 0.05; // fallback
    console.log(`Reference Diameter: ${(refArea * 39.3701).toFixed(2)} in`);
    console.log(`Motor: ${rocket.motor.name}`);

    console.log('\n' + '='.repeat(60));
    console.log('COMPONENT MASS BREAKDOWN:');
    console.log('='.repeat(60));

    function printComponents(components: any[], indent = 0) {
      for (const comp of components) {
        const prefix = '  '.repeat(indent);
        console.log(`${prefix}${comp.type} (${comp.name}): ${(comp.mass * 1000).toFixed(1)}g`);
        if (comp.subComponents && comp.subComponents.length > 0) {
          printComponents(comp.subComponents, indent + 1);
        }
      }
    }

    printComponents(rocket.stages[0].subComponents);

    console.log('\n' + '='.repeat(60));
    const finalMass = rocket.simulationSettings?.mass || dryMass;
    if (Math.abs((finalMass * 1000) - 424) < 20) {
      console.log('✅ PASS: Mass is within range of expected total mass (424g)!');
    } else {
      console.log('❌ FAIL: Mass difference is too large');
    }
    console.log('='.repeat(60));

  } catch (error) {
    console.error('Error parsing file:', error);
  }
}

testFirstOrk();





