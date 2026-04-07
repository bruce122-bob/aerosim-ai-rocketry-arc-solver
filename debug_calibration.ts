import fs from 'fs';
import { parseORKFile } from './services/ork/index.js';
import { runSimulation } from './services/physics6dofStable';
import { findMotorByDesignation } from './services/motorMatcher';
import flightDataJson from './flight_data.json';
import { RocketConfig, Environment } from './types';

interface FlightRecord {
  team: string;
  date: string;
  launch_number: number;
  apogee_ft: number;
  mass_g: number;
  flight_time_s: number;
  ascent_time_s?: number;
  wind_speed_mph?: number;
  wind_direction?: string;
  humidity_percent?: number;
  temp_f?: number;
  temp_c?: number;
  pressure_inhg?: number;
  pressure_hpa?: number;
  motor: string;
  motor_mass_g?: number;
}

const windDirectionToDegrees = (direction?: string): number => {
  const dirMap: Record<string, number> = {
    N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
    E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
    S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
    W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
  };
  return dirMap[(direction || 'N').toUpperCase()] || 0;
};

const recordToEnvironment = (record: FlightRecord): Environment => ({
  windSpeed: (record.wind_speed_mph || 0) * 0.44704,
  windDirection: windDirectionToDegrees(record.wind_direction),
  temperature: record.temp_c ?? (((record.temp_f ?? 68) - 32) * 5 / 9),
  pressure: record.pressure_hpa ?? ((record.pressure_inhg ?? 29.92) * 33.8639),
  humidity: record.humidity_percent ?? 50,
  airDensity: undefined as unknown as number,
});

async function main() {
  const orkPath = '/Users/brucegu/Library/Mobile Documents/com~apple~CloudDocs/Documents/Rocketry/Final rocket design 2.ork';
  const fileBuffer = fs.readFileSync(orkPath);
  const file = new File([fileBuffer], 'Final rocket design 2.ork', { type: 'application/zip' });
  const parsed = await parseORKFile(file);

  if (!parsed.success || !parsed.rocket) {
    throw new Error(`Failed to parse ORK: ${parsed.error}`);
  }

  const rocket = parsed.rocket;
  const records = (flightDataJson as FlightRecord[]).filter(r => r.motor === 'F42-8T').slice(0, 10);

  console.log('Rocket motor:', rocket.motor.name, 'delay=', rocket.motor.delayTime);
  console.log('Rocket imported mass g:', (rocket.simulationSettings?.mass ?? 0) * 1000);

  for (const record of records) {
    const env = recordToEnvironment(record);
    const matchedMotor = findMotorByDesignation(record.motor);
    const modifiedRocket: RocketConfig = {
      ...rocket,
      motor: matchedMotor || rocket.motor,
      manualOverride: {
        ...rocket.manualOverride,
        mass: record.mass_g / 1000,
      },
    };

    const sim = await runSimulation(modifiedRocket, env, 90, 1.0);
    console.log(JSON.stringify({
      team: record.team,
      launch: record.launch_number,
      mass_g: record.mass_g,
      actual_ft: record.apogee_ft,
      sim_ft: +(sim.apogee * 3.28084).toFixed(1),
      sim_time_s: +sim.flightTime.toFixed(2),
      motor: modifiedRocket.motor.name,
      delay: modifiedRocket.motor.delayTime,
      maxVel_mph: +(sim.maxVelocity * 2.23694).toFixed(1),
    }));
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
