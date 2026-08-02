// Shared helpers for the parse scripts.
// Coordinate convention: computed HERE, once, baked into JSON. Consumers never
// recompute positions.

import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { paths } from '../config.mjs';
import { green, red, verbose } from './ui.mjs';

/**
 * RA/Dec (decimal degrees) → unit-sphere Cartesian.
 *   x = cos(dec) * cos(ra)
 *   y = sin(dec)            // +Y = north celestial pole
 *   z = cos(dec) * sin(-ra) // handedness fixed by the -ra
 */
export function raDecToCartesian(raDeg, decDeg) {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  return {
    x: Math.cos(dec) * Math.cos(ra),
    y: Math.sin(dec),
    z: Math.cos(dec) * Math.sin(-ra),
  };
}

/** Round to n decimals for JSON output. 7 decimals keeps |x²+y²+z²−1| ≪ 1e-6. */
export function round(v, n = 7) {
  const f = 10 ** n;
  return Math.round(v * f) / f;
}

export function bakeXYZ(raDeg, decDeg) {
  const { x, y, z } = raDecToCartesian(raDeg, decDeg);
  return { x: round(x), y: round(y), z: round(z) };
}

/**
 * Minimal quote-aware CSV line splitter (handles "quoted, fields" and "" escapes).
 * HYG uses commas + quotes; OpenNGC uses semicolons, no quoting observed —
 * pass the delimiter explicitly.
 */
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

/** Parse a CSV string → array of row objects keyed by header names. */
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

/**
 * OpenNGC sexagesimal → decimal degrees.
 *   RA  "HH:MM:SS.ss"  → hours × 15
 *   Dec "±DD:MM:SS.s"  → degrees (sign applies to the whole value, incl. -00°)
 */
export function sexagesimalToDegrees(str, isRa) {
  const m = str.trim().match(/^([+-]?)(\d+):(\d+):(\d+(?:\.\d+)?)$/);
  if (!m) throw new Error(`Unparseable sexagesimal value: "${str}"`);
  const sign = m[1] === '-' ? -1 : 1;
  const value = Number(m[2]) + Number(m[3]) / 60 + Number(m[4]) / 3600;
  return sign * value * (isRa ? 15 : 1);
}

// Spot checks are quiet on success and counted; the count is what the report
// prints. A failure is loud, complete, and fatal — that contract is unchanged.
let passed = 0;
export const checkCount = () => passed;

function fail(msg) {
  console.error(`\n${red('✗ SPOT-CHECK FAILED')}  ${msg}\n`);
  process.exit(1);
}

/** Fail-loud assertion for the in-script spot checks. */
export function check(cond, msg) {
  if (!cond) fail(msg);
  passed++;
  if (verbose) console.log(`  ${green('✓')} ${msg}`);
}

/**
 * Assert a predicate over every element and report ONCE. Use this instead of
 * calling check() from inside a loop — 695 identical checkmarks are noise, but
 * "all 695 segments hold" is a fact worth one line.
 *
 * The predicate returns true to pass, or a string describing the failure.
 * On failure the offending index and element are included.
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

/**
 * Write one bake into data/, creating the directory on first use.
 * Returns { name, size } for the report line — printing is the caller's job,
 * so the parser's headline lands above its output path.
 */
export function writeOutput(filename, payload, indent) {
  mkdirSync(paths.data, { recursive: true });
  const path = new URL(filename, paths.data);
  writeFileSync(path, JSON.stringify(payload, null, indent) + '\n');
  return { name: `data/${filename}`, size: statSync(path).size };
}
