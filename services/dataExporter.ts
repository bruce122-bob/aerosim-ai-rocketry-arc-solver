/**
 * Flight Data Export Service
 *
 * Exports SimulationResult to CSV or JSON and triggers a browser download.
 * Satisfies requirement 4.7: Data logging system (CSV required, JSON optional).
 */

import { SimulationResult, SimulationPoint, RocketConfig, Environment } from '../types';

// ── CSV ──────────────────────────────────────────────────────────────────────

const CSV_HEADERS = [
  'time_s',
  'altitude_m',
  'altitude_ft',
  'range_m',
  'velocity_ms',
  'velocity_mph',
  'velocityX_ms',
  'velocityY_ms',
  'acceleration_ms2',
  'acceleration_g',
  'thrust_N',
  'drag_N',
  'mass_kg',
  'airDensity_kgm3',
  'cd',
  'mach',
  'pitch_deg',
];

function pointToCSVRow(p: SimulationPoint): string {
  const altFt   = (p.altitude   * 3.28084).toFixed(2);
  const velMph  = (p.velocity   * 2.23694).toFixed(3);
  const accelG  = (p.acceleration / 9.80665).toFixed(4);
  const mach    = p.mach  != null ? p.mach.toFixed(4)  : '';
  const pitch   = p.pitch != null ? p.pitch.toFixed(2) : '';

  return [
    p.time.toFixed(4),
    p.altitude.toFixed(4),
    altFt,
    (p.range ?? 0).toFixed(4),
    p.velocity.toFixed(4),
    velMph,
    (p.velocityX ?? 0).toFixed(4),
    (p.velocityY ?? 0).toFixed(4),
    p.acceleration.toFixed(4),
    accelG,
    p.thrust.toFixed(4),
    p.drag.toFixed(4),
    p.mass.toFixed(5),
    (p.airDensity ?? 0).toFixed(5),
    (p.cd ?? 0).toFixed(4),
    mach,
    pitch,
  ].join(',');
}

export function exportCSV(
  result: SimulationResult,
  rocket?: RocketConfig,
  env?: Environment,
  filename?: string
): void {
  const lines: string[] = [];

  // Header metadata block (commented out so the file is clean CSV)
  lines.push('# BrookX ARC Flight Simulation Data');
  if (rocket) lines.push(`# Rocket: ${rocket.name ?? 'Unknown'}`);
  if (rocket?.motor) lines.push(`# Motor: ${rocket.motor.name}`);
  if (env) {
    lines.push(
      `# Environment: temp=${env.temperature}°C  pressure=${env.pressure}hPa  ` +
      `humidity=${env.humidity}%  wind=${env.windSpeed}m/s @ ${env.windDirection}°`
    );
  }
  lines.push(`# Apogee: ${result.apogee.toFixed(2)} m  (${(result.apogee * 3.28084).toFixed(1)} ft)`);
  lines.push(`# MaxVelocity: ${result.maxVelocity.toFixed(2)} m/s`);
  lines.push(`# FlightTime: ${result.flightTime.toFixed(2)} s`);
  lines.push(`# DataPoints: ${result.data.length}`);
  lines.push('#');

  // Column headers
  lines.push(CSV_HEADERS.join(','));

  // Data rows
  for (const point of result.data) {
    lines.push(pointToCSVRow(point));
  }

  triggerDownload(lines.join('\n'), filename ?? buildFilename('csv', rocket), 'text/csv');
}

// ── JSON ─────────────────────────────────────────────────────────────────────

export function exportJSON(
  result: SimulationResult,
  rocket?: RocketConfig,
  env?: Environment,
  filename?: string
): void {
  const payload = {
    meta: {
      exportedAt:  new Date().toISOString(),
      rocketName:  rocket?.name ?? null,
      motorName:   rocket?.motor?.name ?? null,
      environment: env ?? null,
    },
    summary: {
      apogee_m:         result.apogee,
      apogee_ft:        result.apogee * 3.28084,
      maxVelocity_ms:   result.maxVelocity,
      maxVelocity_mph:  result.maxVelocity * 2.23694,
      flightTime_s:     result.flightTime,
      dataPoints:       result.data.length,
    },
    data: result.data.map(p => ({
      time_s:           p.time,
      altitude_m:       p.altitude,
      altitude_ft:      p.altitude * 3.28084,
      range_m:          p.range ?? 0,
      velocity_ms:      p.velocity,
      velocityX_ms:     p.velocityX ?? 0,
      velocityY_ms:     p.velocityY ?? 0,
      acceleration_ms2: p.acceleration,
      acceleration_g:   p.acceleration / 9.80665,
      thrust_N:         p.thrust,
      drag_N:           p.drag,
      mass_kg:          p.mass,
      airDensity_kgm3:  p.airDensity ?? null,
      cd:               p.cd ?? null,
      mach:             p.mach ?? null,
      pitch_deg:        p.pitch ?? null,
    })),
  };

  triggerDownload(
    JSON.stringify(payload, null, 2),
    filename ?? buildFilename('json', rocket),
    'application/json'
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildFilename(ext: string, rocket?: RocketConfig): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  const rocketSlug = (rocket?.name ?? 'flight').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
  return `${rocketSlug}_${stamp}.${ext}`;
}

function triggerDownload(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
