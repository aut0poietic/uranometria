// HYG v41 → stars.json
//
// A star is kept if mag ≤ bake.magCutoff OR its HIP id appears in a constellation
// line. Requires constellations.json — run parsers/constellations.mjs first.
//
// HYG gotchas: `ra` is in HOURS; its own x,y,z are distance-scaled and ignored;
// `hip` may be empty; `bayer` may carry a component digit ("Alp-2"); row id 0 is
// the Sun.
//
// A constellation segment referencing a HIP absent from HYG exits 1. Do not drop
// segments, do not improvise.

import { readFileSync } from 'node:fs';
import { parseCsv, bakeXYZ, round, check, checkCount, property, todayISO, writeOutput } from '../lib/shared.mjs';
import { readRawText } from '../lib/fetch.mjs';
import { num, note, report, yellow } from '../lib/ui.mjs';
import { formatBayer } from '../lib/star_names.mjs';
import { bake, paths, sources, outputs } from '../config.mjs';

const CONSTELLATIONS = new URL(outputs.constellations, paths.data);

// `label` = proper names only; the dense bake cost ~80 KB labeling stars nobody
// searches for. Unlabeled stars fall back to the HIP id at render time. The full
// proper → Bayer → Flamsteed machinery survives behind bake.labelBayerFallback.
const unmappedBayer = new Map(); // warn at end, don't exit

function bakeLabel(row) {
  // HYG's proper column also carries designations ("96 G. Psc", "3C 273").
  // Digit/Greek-initial ⇒ designation; the spot-check uses the same classifier.
  if (row.proper && !/^[Ͱ-Ͽ\d]/.test(row.proper)) return row.proper;
  if (!bake.labelBayerFallback) return null;
  if (!row.con) return null; // Bayer/Flamsteed need a constellation
  if (row.bayer) {
    const bayerLabel = formatBayer(row.bayer, row.con);
    if (bayerLabel) return bayerLabel;
    unmappedBayer.set(row.bayer, (unmappedBayer.get(row.bayer) ?? 0) + 1);
  }
  if (row.flam) return `${row.flam} ${row.con}`;
  return null;
}

let unionHips;
let constellationsByHip = new Map(); // for dangling-HIP reporting
try {
  const { constellations } = JSON.parse(readFileSync(CONSTELLATIONS, 'utf8'));
  unionHips = new Set();
  for (const c of constellations) {
    for (const { star1, star2 } of c.lines) {
      for (const hip of [star1, star2]) {
        unionHips.add(hip);
        if (!constellationsByHip.has(hip)) constellationsByHip.set(hip, new Set());
        constellationsByHip.get(hip).add(c.abbr);
      }
    }
  }
} catch {
  console.error(`✗ Could not read data/${outputs.constellations} — run parsers/constellations.mjs first.`);
  process.exit(1);
}

const rows = parseCsv(readRawText('hyg'));
note(`HYG rows parsed: ${num(rows.length)}`);

const stars = [];
const seenHips = new Map();
let duplicateHips = 0;

for (const row of rows) {
  if (row.id === '0') continue; // Sol

  const hip = /^\d+$/.test(row.hip) ? Number(row.hip) : null;
  const mag = Number(row.mag);
  if (!Number.isFinite(mag)) continue;

  const keep = mag <= bake.magCutoff || (hip !== null && unionHips.has(hip));
  if (!keep) continue;

  if (hip !== null && seenHips.has(hip)) { duplicateHips++; continue; } // first row wins

  const raDeg = Number(row.ra) * 15; // hours
  const decDeg = Number(row.dec);
  const star = {
    id: hip, // constellation lines key on this
    ra: round(raDeg, 6),
    dec: round(decDeg, 6),
    mag: round(mag, 2),
    ...bakeXYZ(raDeg, decDeg),
  };
  const label = bakeLabel(row);
  if (label) star.label = label;
  const ci = Number(row.ci);
  if (row.ci !== '' && Number.isFinite(ci)) star.ci = round(ci, 3);
  if (hip !== null) seenHips.set(hip, stars.length);
  stars.push(star);
}

note(`Stars kept: ${num(stars.length)} (mag ≤ ${bake.magCutoff} ∪ constellation HIPs; ` +
  `${stars.filter((s) => s.id === null).length} without HIP id, ${duplicateHips} duplicate-HIP rows skipped)`);

const labeled = stars.filter((s) => s.label).length;
const properCount = stars.filter((s) => s.label && !/^[Ͱ-Ͽ\d]/.test(s.label)).length;
note(`Labels baked: ${labeled} (${properCount} proper, ${labeled - properCount} Bayer/Flamsteed)`);
if (unmappedBayer.size > 0) {
  console.warn(`  ${yellow('⚠')} Unmapped Bayer tokens (label fell through to Flamsteed/none):`);
  for (const [token, count] of [...unmappedBayer].sort((a, b) => b[1] - a[1])) {
    console.warn(`     "${token}" × ${count}`);
  }
}

const dangling = [...unionHips].filter((hip) => !seenHips.has(hip));
if (dangling.length > 0) {
  console.error(`\n✗ DANGLING HIP IDS — ${dangling.length} constellation-line star(s) missing from HYG:`);
  for (const hip of dangling.sort((a, b) => a - b)) {
    console.error(`   HIP ${hip} — used by: ${[...constellationsByHip.get(hip)].join(', ')}`);
  }
  console.error('\nSTOP: report these and wait. Do not drop or improvise.');
  process.exit(1);
}
check(true, `every constellation segment resolves to two present stars (${unionHips.size} HIPs all found)`);

{
  const { x, y, z } = bakeXYZ(0, 0);
  check(x === 1 && y === 0 && z === 0, 'Cardinal A: RA 0°, Dec 0° → (1, 0, 0) exactly');
}
{
  const { x, y, z } = bakeXYZ(123.4, 90);
  check(Math.abs(x) < 1e-9 && Math.abs(y - 1) < 1e-9 && Math.abs(z) < 1e-9,
    'Cardinal B: Dec +90° → (0, 1, 0) north celestial pole');
}
{
  const { x, y, z } = bakeXYZ(101.287, -16.716);
  check(Math.abs(x - -0.187) < 0.01 && Math.abs(y - -0.287) < 0.01 && Math.abs(z - -0.939) < 0.01,
    'Worked star (formula): RA 101.287°, Dec −16.716° → ≈ (−0.187, −0.287, −0.939)');
}
{
  const sirius = stars[seenHips.get(32349)];
  check(sirius && Math.abs(sirius.x - -0.187) < 0.01 && Math.abs(sirius.y - -0.287) < 0.01 &&
    Math.abs(sirius.z - -0.939) < 0.01 && sirius.mag < -1,
    `Worked star (parsed): HIP 32349 ${sirius?.label ?? ''} mag ${sirius?.mag} at (${sirius?.x}, ${sirius?.y}, ${sirius?.z})`);
  check(sirius?.label === 'Sirius', `label precedence: HIP 32349 label is "${sirius?.label}" (expected "Sirius")`);
}
{
  const labeled = stars.filter((s) => s.label);
  check(labeled.every((s) => s.label.length > 0), 'labels: no empty strings');
  if (bake.labelBayerFallback) {
    check(labeled.some((s) => /^[Ͱ-Ͽ]/.test(s.label)), 'labels: at least one Bayer-style (Greek-initial) label exists');
    check(labeled.length > 2000 && labeled.length < stars.length,
      `labels: coverage plausible for dense mode (${labeled.length} of ${stars.length})`);
  } else {
    check(labeled.every((s) => !/^[Ͱ-Ͽ\d]/.test(s.label)), 'labels: proper-only mode baked no Bayer/Flamsteed strings');
    check(labeled.length > 200 && labeled.length < 800,
      `labels: coverage plausible for proper-only mode (${labeled.length} of ${stars.length})`);
  }
}
let maxNormErr = 0;
property('all stars on the unit sphere', stars, (s) => {
  const err = Math.abs(s.x ** 2 + s.y ** 2 + s.z ** 2 - 1);
  if (err > maxNormErr) maxNormErr = err;
  return err < 1e-6 || `|x²+y²+z²−1| = ${err} for star ${s.id}`;
});
property('RA ∈ [0,360), Dec ∈ [−90,90], mag plausible', stars, (s) => {
  if (s.ra < 0 || s.ra >= 360) return `RA out of range: ${s.ra} (star ${s.id})`;
  if (s.dec < -90 || s.dec > 90) return `Dec out of range: ${s.dec} (star ${s.id})`;
  if (s.mag < -2 || s.mag > 15) return `implausible mag: ${s.mag} (star ${s.id})`;
  return true;
});

const written = writeOutput(outputs.stars, {
  stars,
  count: stars.length,
  metadata: {
    source: sources.hyg.provenance,
    mag_cutoff: bake.magCutoff,
    union_hip_count: unionHips.size,
    label_count: stars.filter((s) => s.label).length,
    label_precedence: bake.labelBayerFallback
      ? 'proper > bayer > flamsteed'
      : 'proper only (Bayer/Flamsteed behind bake.labelBayerFallback)',
    date_parsed: todayISO(),
  },
});

report('stars',
  `${num(stars.length)} stars · ${labeled} labeled · max sphere err ${maxNormErr.toExponential(1)}`,
  checkCount(), written);
