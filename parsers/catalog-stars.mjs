// stars.json labeled rows ⨝ HYG raw → catalog-stars.json
//
// Set equality BY CONSTRUCTION: no re-filtering of HYG. Takes exactly what
// stars.json labeled and joins back for designation columns only; coords and mags
// ride stars.json verbatim. Run parsers/stars.mjs first.
//
// Ids are the spaceless HIP form (URL-visible verbatim), with an HD fallback for
// the 7 proper-named binary companions whose HIP rode the primary's row. "p
// Eridani" is genuinely two rows and stays two.

import { readFileSync } from 'node:fs';
import { parseCsv, check, checkCount, property, todayISO, writeOutput } from '../lib/shared.mjs';
import { readRawText } from '../lib/fetch.mjs';
import { note, report } from '../lib/ui.mjs';
import { formatBayer } from '../lib/star_names.mjs';
import { bake, paths, sources, outputs } from '../config.mjs';

const STARS = new URL(outputs.stars, paths.data);

// A HYG rerun that changes this set fails on purpose: new HIP-less names mean new
// id decisions, not silent fallbacks.
const EXPECTED_HD_IDS = new Set([
  'HD10361', // p Eridani (Gl 66A — the HIP-less component of the double)
  'HD60178', // Castor B
  'HD98231', // Alula Australis
  'HD98230', // Alula Australis B
  'HD144070', // Graffias
  'HD154906', // Alrakis
  'HD155886', // Guniibuu B
]);

let labeled;
try {
  const { stars } = JSON.parse(readFileSync(STARS, 'utf8'));
  labeled = stars.filter((s) => s.label);
} catch {
  console.error(`✗ Could not read data/${outputs.stars} — run parsers/stars.mjs first.`);
  process.exit(1);
}
note(`stars.json labeled rows: ${labeled.length}`);

const rows = parseCsv(readRawText('hyg'));
const byHip = new Map(); // first row wins, as in parsers/stars.mjs
const hiplessByProper = new Map();
for (const row of rows) {
  if (row.id === '0') continue; // Sol
  if (/^\d+$/.test(row.hip)) {
    const hip = Number(row.hip);
    if (!byHip.has(hip)) byHip.set(hip, row);
  } else if (row.proper) {
    if (!hiplessByProper.has(row.proper)) hiplessByProper.set(row.proper, []);
    hiplessByProper.get(row.proper).push(row);
  }
}

const objects = [];
for (const s of labeled) {
  let row;
  let id;
  let prefix;
  let num;
  if (s.id !== null) {
    row = byHip.get(s.id);
    if (!row) { console.error(`✗ HIP ${s.id} ("${s.label}") not found in HYG raw`); process.exit(1); }
    prefix = 'HIP';
    num = s.id;
  } else {
    // Exactly one HIP-less row may carry this name, else a human decides.
    const candidates = hiplessByProper.get(s.label) ?? [];
    if (candidates.length !== 1) {
      console.error(`✗ Ambiguous HIP-less join for "${s.label}": ${candidates.length} candidate rows. STOP.`);
      process.exit(1);
    }
    row = candidates[0];
    num = /^\d+$/.test(row.hd) ? Number(row.hd) : null;
    if (num === null) { console.error(`✗ "${s.label}" has neither HIP nor HD id. STOP.`); process.exit(1); }
    prefix = 'HD';
  }
  id = `${prefix}${num}`;

  if (row.proper !== s.label) {
    console.error(`✗ Join integrity: ${id} HYG proper "${row.proper}" ≠ baked label "${s.label}"`);
    process.exit(1);
  }

  // Name, Bayer form, catalog number padded and bare.
  const designations = [];
  const add = (d) => {
    const v = String(d ?? '').trim();
    if (v && !designations.some((x) => x.toLowerCase() === v.toLowerCase())) designations.push(v);
  };
  add(s.label);
  if (row.bayer && row.con) add(formatBayer(row.bayer, row.con)); // null drops out in add()
  add(`${prefix} ${num}`);
  add(id);

  objects.push({
    id,
    name: s.label,
    designations,
    ra: s.ra,
    dec: s.dec,
    x: s.x,
    y: s.y,
    z: s.z,
    type: 'star',
    mag: s.mag,
  });
}

objects.sort((a, b) => a.ra - b.ra);

check(true, 'join integrity: every HYG proper matched its baked label (asserted per row)');
check(objects.length === labeled.length,
  `set equality: ${objects.length} catalog rows == ${labeled.length} stars.json labels (by construction)`);
check(objects.length > 200 && objects.length < 800,
  `count plausible for proper-only names (${objects.length})`);
check(new Set(objects.map((o) => o.id)).size === objects.length, 'ids: all unique');
check(objects.every((o) => /^(HIP|HD)\d+$/.test(o.id)), 'ids: all spaceless HIP/HD form');
{
  const hdIds = new Set(objects.filter((o) => o.id.startsWith('HD')).map((o) => o.id));
  const same = hdIds.size === EXPECTED_HD_IDS.size && [...hdIds].every((d) => EXPECTED_HD_IDS.has(d));
  check(same, `HD fallback set is exactly the 7 decided rows (got: ${[...hdIds].join(', ')})`);
}
check(objects.every((o) => o.designations.length >= 3 && o.designations.every((d) => d.length > 0)),
  'designations: every star carries ≥3 non-empty forms (name + padded + bare at minimum)');
check(objects.every((o) => o.designations.includes(o.id)), 'designations: every star carries its own id');
{
  const vega = objects.find((o) => o.id === 'HIP91262');
  check(vega && vega.name === 'Vega' && Math.abs(vega.mag - 0.03) < 0.01
    && ['Vega', 'α Lyr', 'HIP 91262', 'HIP91262'].every((d) => vega.designations.includes(d))
    && Math.abs(vega.x - 0.125) < 0.01 && Math.abs(vega.y - 0.626) < 0.01 && Math.abs(vega.z - 0.769) < 0.01,
    `Vega: HIP91262, mag ${vega?.mag}, designations ${JSON.stringify(vega?.designations)}`);
  const sirius = objects.find((o) => o.id === 'HIP32349');
  check(sirius && sirius.name === 'Sirius' && sirius.mag < -1 && sirius.designations.includes('α CMa'),
    `Sirius: HIP32349, mag ${sirius?.mag}, carries "α CMa"`);
  const polaris = objects.find((o) => o.name === 'Polaris');
  check(polaris && polaris.designations.includes('α UMi') && polaris.y > 0.999,
    `Polaris: ${polaris?.id}, y=${polaris?.y} (on the pole), carries "α UMi"`);
  const pEri = objects.filter((o) => o.name === 'p Eridani');
  check(pEri.length === 2 && new Set(pEri.map((o) => o.id)).size === 2
    && pEri.some((o) => o.id === 'HIP7751') && pEri.some((o) => o.id === 'HD10361'),
    `p Eridani double kept as two rows: ${pEri.map((o) => o.id).join(' + ')}`);
}
let maxNormErr = 0;
property('all rows on the unit sphere, coords in range', objects, (o) => {
  const err = Math.abs(o.x ** 2 + o.y ** 2 + o.z ** 2 - 1);
  if (err > maxNormErr) maxNormErr = err;
  if (err >= 1e-6) return `|x²+y²+z²−1| = ${err} for ${o.id}`;
  if (o.ra < 0 || o.ra >= 360 || o.dec < -90 || o.dec > 90) return `RA/Dec out of range for ${o.id}`;
  return true;
});

const written = writeOutput(outputs.catalogStars, {
  schemaVersion: bake.schemaVersion,
  objects,
  count: objects.length,
  metadata: {
    source: `${outputs.stars} labels ⨝ ${sources.hyg.provenance}`,
    note: 'Proper-named stars as CATALOG rows: pickable, searchable, '
      + 'capturable-in-principle; not subjects until captured. Exactly the '
      + 'stars.json labeled set by construction — this file joins baked labels '
      + 'back to HYG only for designation columns; coords/mags are stars.json '
      + 'verbatim, never recomputed. Ids are spaceless HIP form, HD fallback '
      + 'for the 7 HIP-less named binary companions; designations carry name, '
      + 'Bayer form, and the catalog number padded + bare for combobox search.',
    id_rule: 'HIP spaceless; HD fallback (7 rows, asserted by value)',
    date_parsed: todayISO(),
  },
}, 1);
report('catalog-stars',
  `${objects.length} named stars · ${EXPECTED_HD_IDS.size} HD fallbacks · schema v${bake.schemaVersion}`,
  checkCount(), written);
