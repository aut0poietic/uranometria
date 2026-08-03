// Lynds Bright Nebulae (VizieR VII/9) → catalog-lbn.json
//
// Bakes the LBN-ONLY nebulae — the ones with no NGC/IC/Sharpless/Cederblad
// counterpart anywhere else in this repo's output. Same contract as
// parsers/sharpless.mjs: objects another bake already carries are EXCLUDED
// here and keep their existing key, so nothing is ever double-listed and no
// canonical id moves. LBN 555 is the trigger case — a 145′ Cepheus field with
// no cross-reference in any catalog we previously fetched.
//
// Dedup layers (an LBN object is a duplicate if ANY hits):
//   A. VII/9's own `Name` column names an NGC/IC/S(harpless)/C(ederblad)
//      counterpart. This is the catalog's built-in crosswalk and covers 388 of
//      1125 rows — the reason this bake needs no SIMBAD dump of its own.
//   B. The LBN number already appears as an alias on a raw-OpenNGC row's
//      Identifiers column (the deep-sky bake surfaces those as "LBN 548").
//   C. The LBN number is one SIMBAD lists for a Sharpless object, which the
//      Sharpless bake already emits as an alias (Sh2-101 carries LBN 168).
// Layers B and C read the same raws parsers/deepsky.mjs and parsers/sharpless.mjs
// read, never their output — every parser stays independently runnable.
//
// There is deliberately NO positional layer. Sharpless has one (a flag routed
// through hand curation) because 313 rows is curatable; 737 is not, and Lynds'
// plate-measured extents are far too coarse to resolve a near-miss into a
// verdict. The identifier layers are exact; a residual duplicate here is a
// missing cross-reference in VII/9, not a silent merge.
//
// Field rules mirror the Sharpless bake (diffuse nebulae, no integrated mag):
//   mag/surf_br/redshift: null. capturable: true for everything admitted.
//   difficulty: Lynds brightness 1-2 → 'moderate', 3-4 → 'dark', 5-6 → 'dark'.
//     The index is a 1965 blue-plate judgement, so it never promotes to 'easy'.
//   size_arcmin: Diam1, the largest dimension.

import { bakeXYZ, round, check, checkCount, property, todayISO, writeOutput, precessB1950toJ2000, parseCsv } from '../lib/shared.mjs';
import { readRawText } from '../lib/fetch.mjs';
import { num, note, report } from '../lib/ui.mjs';
import { loadSharplessCrosswalk } from '../lib/sharpless_crosswalk.mjs';
import { bake, scopes, RESOLVE_PX, sources, outputs } from '../config.mjs';

// VII/9 fixed-width byte columns, per the VizieR ReadMe.
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

// ---- Layers B and C: LBN numbers other bakes already carry -----------------
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

// ---- dedup + size gate ------------------------------------------------------
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

// ---- fail-loud spot checks --------------------------------------------------
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

// The trigger case — LBN 555, B1950 21h00m +79°00′ → J2000 ≈ 314.5 +79.2
// (SIMBAD's LBN 113.08+21.10). Brightness 6 is exactly why the gate is on size.
const lbn555 = objects.find((o) => o.id === 'LBN555');
check(lbn555 && Math.abs(lbn555.ra - 314.5) < 0.5 && Math.abs(lbn555.dec - 79.2) < 0.2
  && lbn555.size_arcmin === 145 && lbn555.lynds_brightness === 6 && lbn555.capturable,
  `LBN 555 present: RA ${lbn555?.ra}, Dec ${lbn555?.dec}, ${lbn555?.size_arcmin}′, class ${lbn555?.lynds_brightness}`);

// Dedup worked examples — every one of these is carried by another bake and
// must NOT be minted here. 511 → the Wizard (NGC 7380), 548 → the Bubble
// (NGC 7635), 168 → the Tulip (Sh2-101), 234 → the gamma Cyg region (Sh2-108).
property('canonical-id stability: LBN numbers other bakes already carry are excluded',
  [511, 548, 168, 234, 274],
  (n) => !objects.some((o) => o.id === `LBN${n}`) || `LBN${n} was minted despite being a duplicate`);

// No object may appear both here and in another bake — the property the three
// identifier layers exist to guarantee.
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
