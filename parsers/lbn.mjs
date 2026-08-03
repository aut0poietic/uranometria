// Lynds Bright Nebulae (VizieR VII/9) → catalog-lbn.json
//
// LBN-ONLY nebulae: the ones no other bake here carries. Same contract as
// parsers/sharpless.mjs — duplicates are excluded and keep their existing key,
// so no canonical id ever moves.
//
// An LBN object is a duplicate if ANY layer hits:
//   A. VII/9's own `Name` column names an NGC/IC/Sharpless/Cederblad counterpart
//      (388 of 1125 rows — why this bake needs no SIMBAD dump of its own).
//   B. The number is already an alias on a raw-OpenNGC row's Identifiers column.
//   C. SIMBAD lists the number for a Sharpless object (Sh2-101 carries LBN 168).
// B and C read raws, never the other bakes' output.
//
// No positional layer, deliberately: 737 rows is not curatable the way Sharpless'
// 313 is, and Lynds' plate extents are too coarse to turn a near-miss into a
// verdict. The identifier layers are exact; a residual duplicate means a missing
// VII/9 cross-reference, not a silent merge.
//
// Field rules mirror the Sharpless bake. Brightness never promotes to 'easy' — it
// is a 1965 plate judgement.

import { bakeXYZ, round, check, checkCount, property, todayISO, writeOutput, precessB1950toJ2000, parseCsv } from '../lib/shared.mjs';
import { readRawText } from '../lib/fetch.mjs';
import { num, note, report } from '../lib/ui.mjs';
import { loadSharplessCrosswalk } from '../lib/sharpless_crosswalk.mjs';
import { bake, scopes, RESOLVE_PX, sources, outputs } from '../config.mjs';

// Byte columns per the VizieR ReadMe.
const fw = (line, a, b) => line.slice(a - 1, b).trim();
const rows = readRawText('lbn')
  .split(/\r?\n/).filter((l) => l.trim().length > 0)
  .map((l) => {
    const sign = fw(l, 28, 28) === '-' ? -1 : 1;
    const row = {
      n: Number(fw(l, 2, 5)),
      ra1950: (Number(fw(l, 21, 22)) + Number(fw(l, 24, 25)) / 60) * 15,
      dec1950: sign * (Number(fw(l, 29, 30)) + Number(fw(l, 32, 33)) / 60),
      diam: Number(fw(l, 36, 39)),   // largest dimension, arcmin
      diamMin: Number(fw(l, 41, 43)), // smallest dimension, arcmin
      area: Number(fw(l, 45, 51)),   // square degrees
      bright: Number(fw(l, 55, 55)), // 1 brightest … 6 barely detectable
      xref: fw(l, 61, 68),           // NGC/IC/S/C/DG counterpart, blank if none
    };
    return { ...row, ...precessB1950toJ2000(row.ra1950, row.dec1950) };
  });
note(`VII/9 rows parsed: ${num(rows.length)}`);

// Layers B and C: numbers other bakes already carry.
const normId = (s) => s.replace(/\s+/g, ' ').trim().toUpperCase().replace(/^([A-Z]+) 0+(\d)/, '$1 $2');
const lbnNumber = (id) => {
  const m = normId(id).match(/^LBN (\d+)$/);
  return m ? Number(m[1]) : null;
};

const claimed = new Map(); // n → which bake already carries it
const ngcRows = [
  ...parseCsv(readRawText('openngc'), ';'),
  ...parseCsv(readRawText('openngcAddendum'), ';'),
];
for (const r of ngcRows) {
  for (const raw of (r.Identifiers || '').split(',')) {
    const n = lbnNumber(raw);
    if (n !== null && !claimed.has(n)) claimed.set(n, `openngc:${r.Name}`);
  }
}
const { simbadIds } = loadSharplessCrosswalk();
for (const [sh2, ids] of simbadIds) {
  for (const raw of ids) {
    const n = lbnNumber(raw);
    if (n !== null && !claimed.has(n)) claimed.set(n, `sharpless:Sh2-${sh2}`);
  }
}

const duplicates = [];
const undersized = [];
const kept = [];
for (const r of rows) {
  if (r.xref) { duplicates.push({ n: r.n, via: 'vii9-xref', match: r.xref }); continue; }
  if (claimed.has(r.n)) { duplicates.push({ n: r.n, via: 'alias', match: claimed.get(r.n) }); continue; }
  if (!(r.diam >= bake.lbnMinDiamArcmin)) { undersized.push(r.n); continue; }
  kept.push(r);
}

const difficulty = (bright) => (bright >= 1 && bright <= 2 ? 'moderate' : 'dark');

const objects = kept
  .map((r) => ({
    id: `LBN${r.n}`,
    name: null,
    messier: null,
    designations: [`LBN${r.n}`, `LBN ${r.n}`, `Lynds ${r.n}`, `Lynds${r.n}`],
    ra: round(r.ra, 6),
    dec: round(r.dec, 6),
    ...bakeXYZ(r.ra, r.dec),
    type: 'nebula',
    mag: null,
    size_arcmin: r.diam,
    size_minor_arcmin: r.diamMin,
    area_deg2: r.area,
    lynds_brightness: r.bright,
    surf_br: null,
    difficulty: difficulty(r.bright),
    capturable: true,
    resolves_on: Object.entries(scopes)
      .filter(([, sc]) => (r.diam * 60) / sc.pxScale >= RESOLVE_PX)
      .map(([k]) => k),
    fits_fov: Object.entries(scopes)
      .filter(([, sc]) => r.diam <= sc.fovShortArcmin)
      .map(([k]) => k),
    redshift: null,
  }))
  .sort((a, b) => a.ra - b.ra);

check(rows.length === 1125, `VII/9 parsed in full (1125 rows, got ${rows.length})`);
check(rows.filter((r) => r.xref).length === 388,
  `${rows.filter((r) => r.xref).length} rows carry a VII/9 cross-reference (expected 388)`);

property('all objects on the unit sphere, ids well-formed, coords in range', objects, (o) => {
  const err = Math.abs(o.x ** 2 + o.y ** 2 + o.z ** 2 - 1);
  if (err >= 1e-6) return `|x²+y²+z²−1| = ${err} for ${o.id}`;
  if (o.ra < 0 || o.ra > 360 || o.dec < -90 || o.dec > 90) return `bad coords for ${o.id}`;
  if (!/^LBN\d+$/.test(o.id)) return `malformed id "${o.id}"`;
  return true;
});

// The trigger case. Brightness 6 is exactly why the gate is on size.
const lbn555 = objects.find((o) => o.id === 'LBN555');
check(lbn555 && Math.abs(lbn555.ra - 314.5) < 0.5 && Math.abs(lbn555.dec - 79.2) < 0.2
  && lbn555.size_arcmin === 145 && lbn555.lynds_brightness === 6 && lbn555.capturable,
  `LBN 555 present: RA ${lbn555?.ra}, Dec ${lbn555?.dec}, ${lbn555?.size_arcmin}′, class ${lbn555?.lynds_brightness}`);

// 511 → Wizard, 548 → Bubble, 168 → Tulip, 234 → the gamma Cyg region.
property('canonical-id stability: LBN numbers other bakes already carry are excluded',
  [511, 548, 168, 234, 274],
  (n) => !objects.some((o) => o.id === `LBN${n}`) || `LBN${n} was minted despite being a duplicate`);

// The property the three identifier layers exist to guarantee.
property('no minted object is claimed by another bake', objects,
  (o) => !claimed.has(Number(o.id.slice(3))) || `${o.id} is also ${claimed.get(Number(o.id.slice(3)))}`);

check(duplicates.length > 380 && kept.length === rows.length - duplicates.length - undersized.length,
  `${duplicates.length} duplicates excluded, ${undersized.length} under the ${bake.lbnMinDiamArcmin}′ gate, ${kept.length} minted`);
check(objects.every((o) => o.capturable && o.mag === null && o.size_arcmin >= bake.lbnMinDiamArcmin),
  'property: every object is capturable, mag-less, and clears the size gate');
check(objects.length > 400 && objects.length < 700,
  `object count in expected band for a ${bake.lbnMinDiamArcmin}′ gate (got ${objects.length})`);

const byDiff = objects.reduce((m, o) => ((m[o.difficulty] = (m[o.difficulty] || 0) + 1), m), {});
note(`difficulty split: ${JSON.stringify(byDiff)}`);
const byVia = duplicates.reduce((m, d) => ((m[d.via] = (m[d.via] || 0) + 1), m), {});
note(`duplicates by layer: ${JSON.stringify(byVia)}`);

const written = writeOutput(outputs.lbn, {
  objects,
  count: objects.length,
  metadata: {
    source: sources.lbn.provenance,
    note: 'LBN-ONLY bright nebulae — every Lynds object with a counterpart in '
      + `${outputs.deepsky} or ${outputs.sharpless} (by VII/9's own NGC/IC/Sharpless/`
      + 'Cederblad cross-reference column, or by an LBN number those bakes already '
      + 'carry as an alias) is excluded and keeps its existing key. Positions '
      + 'precessed B1950→J2000 at bake; unit-sphere x/y/z. mag and surf_br are null '
      + 'by rule (diffuse nebulae), capturable is true by rule. Admission gates on '
      + 'angular extent, NOT on `lynds_brightness` — that index is a 1965 Palomar '
      + 'blue-plate judgement and does not predict what a modern sensor can stack.',
    min_diam_arcmin: bake.lbnMinDiamArcmin,
    excluded_duplicates: duplicates.length,
    excluded_undersized: undersized.length,
    date_parsed: todayISO(),
  },
}, 1);
report('lbn',
  `${num(objects.length)} LBN-only nebulae · ${duplicates.length} duplicates · ${undersized.length} under ${bake.lbnMinDiamArcmin}′`,
  checkCount(), written);
