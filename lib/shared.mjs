import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { paths } from '../config.mjs';
import { green, red, verbose } from './ui.mjs';

/** RA/Dec degrees → unit-sphere Cartesian. +Y = north celestial pole. */
export function raDecToCartesian(raDeg, decDeg) {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  return {
    x: Math.cos(dec) * Math.cos(ra),
    y: Math.sin(dec),
    z: Math.cos(dec) * Math.sin(-ra),
  };
}

/** 7 decimals keeps |x²+y²+z²−1| ≪ 1e-6. */
export function round(v, n = 7) {
  const f = 10 ** n;
  return Math.round(v * f) / f;
}

export function bakeXYZ(raDeg, decDeg) {
  const { x, y, z } = raDecToCartesian(raDeg, decDeg);
  return { x: round(x), y: round(y), z: round(z) };
}

// FK4→FK5 rotation (Murray 1989). E-terms of aberration (~1″) ignored: three
// orders below these catalogs' arcmin centroids.
const FK4_TO_FK5 = [
  [0.9999256794956877, -0.0111814832204662, -0.0048590038153592],
  [0.0111814832391717, 0.9999374848933135, -0.0000271625947142],
  [0.0048590037723143, -0.0000271702937440, 0.9999881946023742],
];
export function precessB1950toJ2000(raDeg, decDeg) {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  const v = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  const w = FK4_TO_FK5.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  return {
    ra: ((Math.atan2(w[1], w[0]) * 180) / Math.PI + 360) % 360,
    dec: (Math.asin(w[2] / Math.hypot(...w)) * 180) / Math.PI,
  };
}

/** Quote-aware CSV line splitter. Handles "quoted, fields" and "" escapes. */
export function splitCsvLine(line, delim = ',') {
  const out = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      out.push(field); field = '';
    } else field += ch;
  }
  out.push(field);
  return out;
}

/** CSV string → row objects keyed by header name. */
export function parseCsv(text, delim = ',') {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = splitCsvLine(lines[0], delim);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line, delim);
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    return row;
  });
}

/** "HH:MM:SS.ss" / "±DD:MM:SS.s" → degrees. Sign applies to the whole value, incl. -00°. */
export function sexagesimalToDegrees(str, isRa) {
  const m = str.trim().match(/^([+-]?)(\d+):(\d+):(\d+(?:\.\d+)?)$/);
  if (!m) throw new Error(`Unparseable sexagesimal value: "${str}"`);
  const sign = m[1] === '-' ? -1 : 1;
  const value = Number(m[2]) + Number(m[3]) / 60 + Number(m[4]) / 3600;
  return sign * value * (isRa ? 15 : 1);
}

let passed = 0;
export const checkCount = () => passed;

function fail(msg) {
  console.error(`\n${red('✗ SPOT-CHECK FAILED')}  ${msg}\n`);
  process.exit(1);
}

export function check(cond, msg) {
  if (!cond) fail(msg);
  passed++;
  if (verbose) console.log(`  ${green('✓')} ${msg}`);
}

/**
 * Assert over every element, report ONCE. Use instead of check() in a loop.
 * Predicate returns true to pass, or a string describing the failure.
 */
export function property(label, items, predicate) {
  let i = 0;
  for (const item of items) {
    const ok = predicate(item, i);
    if (ok !== true) {
      const detail = typeof ok === 'string' ? ok : JSON.stringify(item)?.slice(0, 300);
      fail(`${label}\n   failed at index ${i}: ${detail}`);
    }
    i++;
  }
  passed++;
  if (verbose) console.log(`  ${green('✓')} ${label} (${i} items)`);
  return i;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Writes one bake into data/. Returns { name, size } for the caller's report line. */
export function writeOutput(filename, payload, indent) {
  mkdirSync(paths.data, { recursive: true });
  const path = new URL(filename, paths.data);
  writeFileSync(path, JSON.stringify(payload, null, indent) + '\n');
  return { name: `data/${filename}`, size: statSync(path).size };
}
