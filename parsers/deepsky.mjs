// OpenNGC → catalog-opengc.json
//
// A full-sky reference catalog of deep-sky objects a backyard imager could
// reasonably target, baked as a DATA SOURCE (not a render layer): it backs a
// subject picker and a spatial "cosmic neighborhood" lookup.
//
// Design:
//  - Full sky, no declination gate — targets travel.
//  - Boundary = bake.magCeiling (13.0): every plausible subject for a 30–50mm
//    smart scope (~mag 12) PLUS a brighter context layer to populate
//    neighborhoods, without the ~9k anonymous 14th-mag PGC galaxies. Bump to
//    Infinity for the full ~12k catalog if neighborhoods must show faint
//    cluster membership. Nebular types with NO mag at all are exempt
//    (NULLMAG_EXEMPT below) — otherwise Pacman-class emission targets vanish.
//  - Per-object capturability is BAKED, not filtered out: `capturable`,
//    `difficulty` (surface-brightness → Bortle axis), `resolves_on` and
//    `fits_fov` (per-scope geometry). Consumers filter downstream.
//  - `redshift` preserved: current x,y,z are UNIT-SPHERE (angular only). A true
//    3D neighborhood needs distance; redshift is the only free-at-parse insurance.

import { parseCsv, sexagesimalToDegrees, bakeXYZ, round, check, checkCount, property, todayISO, writeOutput } from '../lib/shared.mjs';
import { readRawText } from '../lib/fetch.mjs';
import { num, note, report } from '../lib/ui.mjs';
import { loadSharplessCrosswalk, sh2Variants } from '../lib/sharpless_crosswalk.mjs';
import { bake, scopes, RESOLVE_PX, sources, outputs, TYPE_MAP } from '../config.mjs';

// Real imaging targets only — drop stars, doubles, duplicates, non-existent,
// associations, novae, dark nebulae (no emission to stack).
const KEEP = new Set(['G', 'OCl', 'GPair', 'GCl', 'PN', 'Neb', 'HII', 'Cl+N',
  'RfN', 'GTrpl', 'GGroup', 'SNR', 'EmN']);

// Categories that drive type-aware capturability rules.
const EXTENDED = new Set(['G', 'GPair', 'GTrpl', 'GGroup', 'Neb', 'RfN']); // want resolved structure
const EMISSION = new Set(['EmN', 'HII', 'Cl+N']);                          // duo-band filter → deeper
const COMPACT = new Set(['GCl', 'PN', 'OCl', 'SNR']);                      // fine when small/bright

// Null-mag exemption: diffuse nebulae frequently have NO integrated V/B
// magnitude in OpenNGC — dropping them excluded 159 real NGC/IC nebulae, among
// them Pacman, Seagull, Thor's Helmet, Running Man, Cat's Paw, IC 1396 and the
// Cave. Nebular types survive a null mag with explicit HII-style rules
// (mirroring the Sharpless bake: capturable, difficulty 'dark' unless SurfBr
// says otherwise — narrowband doesn't gate on visual mag). Everything else (the
// ~500 mag-less galaxy pairs/clusters — survey cruft the ceiling exists to
// block) still drops. Objects that HAVE a mag are unaffected either way.
const NULLMAG_EXEMPT = new Set(['Neb', 'EmN', 'HII', 'RfN', 'SNR', 'Cl+N']);

const numOrNull = (v) => (v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

// --- Cross-catalog designations ---------------------------------------------
// The OpenNGC `Identifiers` column carries cross-catalog IDs but is mostly
// survey cruft (2MASX, PGC, SDSS, IRAS, MCG, ESO-LV, MWSC...). Keep only the
// amateur-facing catalogs an imager would actually search by; Sharpless is the
// one that motivated this. Extend KEEP_ID freely — matching is case-insensitive.
const KEEP_ID = [
  /^Sh\s*2-\s*\d/i,                  // Sharpless (rare in OpenNGC main file; mostly VizieR)
  /^C\s+\d/i,                        // Caldwell — "C 011"
  /^LBN\b/i, /^LDN\b/i,
  /^Ced\b/i, /^Cederblad\b/i,
  /^RCW\b/i, /^Gum\b/i, /^vdB\b/i,
  /^Barnard\b/i,
  /^Collinder\b/i, /^Cr\s/i, /^Cl\s/i,
  /^Melotte\b/i, /^Mel\s/i,
  /^Trumpler\b/i, /^Tr\s/i,
  /^Stock\b/i, /^Abell\b/i,
];

// Canonicalize one raw designation into the 1-2 forms people type into the
// combobox. Sharpless → "Sh2-155". "PREFIX 0NN" → both spaced and compact (so
// "C 11" and "C11" both match); Caldwell "C" also expands to the full word.
function designationVariants(raw) {
  const id = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!id) return [];
  const sh = id.match(/^Sh\s*2-\s*(\d+)$/i);
  if (sh) return [`Sh2-${sh[1]}`];
  const m = id.match(/^([A-Za-z]+)\s+0*(\d+[A-Za-z]?)$/);
  if (!m) return [id];
  const [, prefix, num] = m;
  const forms = new Set([`${prefix} ${num}`, `${prefix}${num}`]);
  if (/^C$/i.test(prefix)) { forms.add(`Caldwell ${num}`); forms.add(`Caldwell${num}`); }
  return [...forms];
}

// OpenNGC ids are zero-padded (NGC0224, IC0001); people type "NGC224". Emit both
// the padded and bare forms so either substring-matches in the combobox.
function idVariants(name) {
  const m = name.match(/^(NGC|IC)0*(\d+)([A-Za-z].*)?$/);
  if (!m) return [name];
  const bare = `${m[1]}${m[2]}${m[3] ?? ''}`;
  return name === bare ? [name] : [name, bare];
}

// Full designation list for one object: primary id (padded + bare), Messier,
// secondary NGC/IC cross-refs, and the allow-listed Identifiers entries.
// De-duped case-insensitively; every object gets at least its own id.
function designationsFor(row, messier) {
  const seen = [];
  const add = (d) => {
    for (const v of [d].flat()) {
      const s = String(v ?? '').trim();
      if (s && !seen.some((x) => x.toLowerCase() === s.toLowerCase())) seen.push(s);
    }
  };
  idVariants(row.Name).forEach(add);
  if (messier) add(messier);
  if (row.NGC) idVariants(`NGC${row.NGC}`).forEach(add);
  if (row.IC) idVariants(`IC${row.IC}`).forEach(add);
  if (row.Identifiers) {
    for (const raw of row.Identifiers.split(',')) {
      const id = raw.trim();
      if (id && KEEP_ID.some((re) => re.test(id))) add(designationVariants(id));
    }
  }
  return seen;
}

function capturable(type, mag) {
  if (mag === null) return NULLMAG_EXEMPT.has(type); // mag-less nebulae are narrowband targets
  if (EXTENDED.has(type)) return mag <= 12.0;
  if (EMISSION.has(type)) return mag <= 13.0; // narrowband filter punches through LP
  return mag <= 12.5;                         // compact/bright
}

function difficulty(type, mag, surfBr) {
  if (surfBr !== null) {
    if (surfBr < 21) return 'easy';
    if (surfBr < 23) return 'moderate';
    return 'dark';
  }
  // No surface brightness AND no mag: only exempt nebulae get here — assume
  // dark-sky/narrowband territory, same rule as the Sharpless bake.
  if (mag === null) return 'dark';
  // No surface brightness (common for clusters): fall back to type + integrated mag.
  if (COMPACT.has(type)) return mag <= 9 ? 'easy' : 'moderate';
  return 'moderate';
}

function resolvesOn(sizeArcmin) {
  if (sizeArcmin === null) return [];
  return Object.entries(scopes)
    .filter(([, s]) => (sizeArcmin * 60) / s.pxScale >= RESOLVE_PX)
    .map(([k]) => k);
}

function fitsFov(sizeArcmin) {
  // Fits a single frame (no mosaic) if it's within the scope's short-axis FOV.
  if (sizeArcmin === null) return Object.keys(scopes);
  return Object.entries(scopes)
    .filter(([, s]) => sizeArcmin <= s.fovShortArcmin)
    .map(([k]) => k);
}

function toObject(row) {
  const type = TYPE_MAP[row.Type] ?? 'other';
  if (!KEEP.has(row.Type)) return null;
  if (!row.RA || !row.Dec) return null;
  const mag = numOrNull(row['V-Mag']) ?? numOrNull(row['B-Mag']);
  if (mag === null && !NULLMAG_EXEMPT.has(row.Type)) return null;
  if (mag !== null && mag > bake.magCeiling) return null;

  const ra = sexagesimalToDegrees(row.RA, true);
  const dec = sexagesimalToDegrees(row.Dec, false);
  const size = numOrNull(row.MajAx);
  const surfBr = numOrNull(row.SurfBr);
  const messier = row.M ? `M${Number(row.M)}` : null;

  return {
    id: row.Name,
    name: row['Common names'] ? row['Common names'].split(',')[0] : null,
    messier,
    designations: designationsFor(row, messier),
    ra: round(ra, 6),
    dec: round(dec, 6),
    ...bakeXYZ(ra, dec),
    type,
    mag,
    size_arcmin: size,
    surf_br: surfBr,
    difficulty: difficulty(row.Type, mag, surfBr),
    capturable: capturable(row.Type, mag),
    resolves_on: resolvesOn(size),
    fits_fov: fitsFov(size),
    redshift: numOrNull(row.Redshift),
  };
}

const rows = [
  ...parseCsv(readRawText('openngc'), ';'),
  ...parseCsv(readRawText('openngcAddendum'), ';'),
];
note(`OpenNGC rows parsed: ${num(rows.length)} (NGC + addendum)`);

// De-dup by Name (addendum can re-list a handful), keep first, sort by RA for
// spatial locality (helps the neighborhood lookup; consumers re-index anyway).
const byName = new Map();
for (const row of rows) {
  const obj = toObject(row);
  if (obj && !byName.has(obj.id)) byName.set(obj.id, obj);
}
const objects = [...byName.values()].sort((a, b) => a.ra - b.ra);

// ---- Sharpless alias + name merge ------------------------------------------
// Every Sh2 object the crosswalk resolves to an OpenNGC counterpart gains its
// Sharpless designation ON the existing row (canonical-id stability — the
// Bubble += Sh2-162, never a second row), plus a curated common name when
// OpenNGC has none (NGC 7380 += "Wizard Nebula"; fill-when-empty only, an
// OpenNGC name always wins). Pairs whose row is NOT in this bake (null-mag
// drop / mag ceiling) are reported, not failed — they enrich automatically
// once those rows enter the bake.
const { overlaps, curation } = loadSharplessCrosswalk();
const byMessier = new Map(objects.filter((o) => o.messier).map((o) => [o.messier, o]));
// Crosswalk match ids arrive in mixed forms ("NGC 281", "NGC6334", "M 8",
// "C009") → resolve to the bake's zero-padded keys / Messier numbers.
function resolveMatch(match) {
  let m = match.match(/^(NGC|IC)\s*0*(\d+)$/);
  if (m) return byName.get(`${m[1]}${m[2].padStart(4, '0')}`) ?? byName.get(`${m[1]}${m[2]}`);
  m = match.match(/^M\s*(\d+)$/);
  if (m) return byMessier.get(`M${m[1]}`);
  return byName.get(match);
}
const sh2Unbaked = [];
let sh2Aliased = 0;
let sh2Named = 0;
for (const { n, match } of overlaps) {
  const row = resolveMatch(match);
  if (!row) { sh2Unbaked.push(`Sh2-${n}→${match}`); continue; }
  for (const v of sh2Variants(n)) {
    if (!row.designations.some((d) => d.toLowerCase() === v.toLowerCase())) row.designations.push(v);
  }
  sh2Aliased++;
  const curName = curation.overlap_common_names?.[String(n)];
  if (curName && !row.name) { row.name = curName; sh2Named++; }
}

// ---- Fail-loud spot checks ----
check(objects.length > 2500 && objects.length < 4000,
  `object count in expected band for mag ≤ ${bake.magCeiling} (got ${objects.length})`);

property('all objects on the unit sphere, coords in range', objects, (o) => {
  const err = Math.abs(o.x ** 2 + o.y ** 2 + o.z ** 2 - 1);
  if (err >= 1e-6) return `|x²+y²+z²−1| = ${err} for ${o.id}`;
  if (o.ra < 0 || o.ra > 360 || o.dec < -90 || o.dec > 90) return `coordinate out of range for ${o.id}`;
  return true;
});

// Worked example — the Crab (NGC1952 / M1).
const crab = byName.get('NGC1952');
check(crab && crab.messier === 'M1' && crab.type === 'supernova_remnant'
  && Math.abs(crab.ra - 83.6332) < 0.01 && Math.abs(crab.dec - 22.0145) < 0.01,
  `Crab Nebula (NGC1952=M1) present: RA ${crab?.ra}, Dec ${crab?.dec}, mag ${crab?.mag}`);

// A known capturable showpiece resolves on the higher-res scope.
const m31 = byName.get('NGC0224');
check(m31 && m31.capturable && m31.resolves_on.includes('s50'),
  `M31 (NGC0224) capturable and resolves on S50`);

// Designations — the cross-catalog alias layer.
check(objects.every((o) => o.designations.length >= 1),
  'property: every object carries at least its own id in designations');
check(m31.designations.includes('NGC224'),
  `M31 designations include un-padded "NGC224" for search (${JSON.stringify(m31.designations)})`);
// OpenNGC main file carries Caldwell/LBN, NOT Sharpless (that arrives via the
// crosswalk merge). Worked example: the Bubble, NGC7635 → Identifiers
// "C 011,LBN 548" + merged Sh2-162.
const bubble = byName.get('NGC7635');
check(bubble
  && bubble.designations.some((d) => /^LBN\s*548$/i.test(d))
  && bubble.designations.some((d) => /^caldwell\s*11$/i.test(d))
  && bubble.designations.includes('Sh2-162'),
  `Bubble (NGC7635) carries LBN 548 + Caldwell 11 + merged Sh2-162 (${JSON.stringify(bubble?.designations)})`);
const withAlias = objects.filter((o) => o.designations.length > 1);
check(withAlias.length > 40,
  `${withAlias.length} objects carry ≥1 cross-catalog alias beyond their own id`);

// Merge worked examples: the Wizard — no OpenNGC common name, unsearchable before this.
const wizard = byName.get('NGC7380');
check(wizard && wizard.name === 'Wizard Nebula' && wizard.designations.includes('Sh2-142'),
  `Wizard (NGC7380) named + carries Sh2-142 (${JSON.stringify(wizard?.name)}, ${JSON.stringify(wizard?.designations)})`);
const heart = byName.get('IC1805');
check(heart && heart.name === 'Heart Nebula' && heart.designations.includes('Sh2-190'),
  `Heart (IC1805) named + carries Sh2-190`);
// Fill-when-empty: an existing OpenNGC name is never overwritten.
const orion = byName.get('NGC1976');
check(orion && orion.name === 'Great Orion Nebula' && orion.designations.includes('Sh2-281'),
  `Orion (NGC1976) keeps its OpenNGC name, gains Sh2-281`);
check(objects.length === byName.size,
  `merge added no rows: still ${objects.length} objects`);
check(sh2Aliased >= 25 && sh2Aliased + sh2Unbaked.length === overlaps.length,
  `${sh2Aliased} rows gained an Sh2 alias (${sh2Named} also named); ${sh2Unbaked.length} pairs point at rows not in this bake`);
// With the null-mag exemption, only two pairs remain unbaked — both MAG
// CEILING cases, a deliberately separate knob: NGC 6842 (PN, mag 13.1) and
// IC 63 (Ghost of Cassiopeia, B 13.33). If this fails, the ceiling moved —
// re-review these two.
check(sh2Unbaked.length === 2
  && sh2Unbaked.some((p) => p.includes('NGC 6842')) && sh2Unbaked.some((p) => p.includes('IC0063')),
  `remaining unbaked pairs are exactly the two mag-ceiling cases: ${sh2Unbaked.join(', ')}`);

// Null-mag exemption worked examples — famous targets the drop used to hide.
// Pacman/Seagull/Thor's Helmet names come from the Sharpless curation (OpenNGC
// has none); Running Man and the Cave keep their OpenNGC names.
property('null-mag recovery: Pacman, Seagull, Thor\'s Helmet, Running Man, Cave, IC 1396 '
  + 'all present, named, Sh2-aliased, capturable/dark', [
  ['NGC0281', 'Pacman Nebula', 'Sh2-184'],
  ['IC2177', 'Seagull Nebula', 'Sh2-292'],
  ['NGC2359', "Thor's Helmet", 'Sh2-298'],
  ['NGC1977', 'the Running Man Nebula', 'Sh2-279'],
  ['C009', 'Cave Nebula', 'Sh2-155'],
  ['IC1396', "Elephant's Trunk Nebula", 'Sh2-131'],
], ([id, name, sh2]) => {
  const o = byName.get(id);
  return (o && o.name === name && o.designations.includes(sh2) && o.capturable
    && o.mag === null && o.difficulty === 'dark') || `${id}: ${JSON.stringify(o)}`;
});
const nullMag = objects.filter((o) => o.mag === null);
check(nullMag.length > 100 && nullMag.length < 250 && nullMag.every((o) => o.capturable && o.difficulty !== 'easy'),
  `${nullMag.length} mag-less nebulae admitted under the exemption, all capturable, none classified easy`);

const capturableCount = objects.filter((o) => o.capturable).length;
const contextCount = objects.length - capturableCount;
const byDiff = objects.reduce((m, o) => ((m[o.difficulty] = (m[o.difficulty] || 0) + 1), m), {});
check(capturableCount > 1500,
  `${capturableCount} flagged capturable, ${contextCount} context-only`);
note(`difficulty split: ${JSON.stringify(byDiff)}`);

const written = writeOutput(outputs.deepsky, {
  objects,
  count: objects.length,
  metadata: {
    source: sources.openngc.provenance,
    note: 'Full-sky deep-sky reference catalog (data source for subject '
      + 'placement + cosmic-neighborhood lookup; not a render layer). Positions/'
      + 'types/mags/sizes from OpenNGC. Coordinates are unit-sphere (angular). '
      + 'Each object carries a `designations` alias list (own id padded + bare, '
      + 'Messier, NGC/IC cross-refs, and amateur cross-catalogs — Caldwell, LBN, '
      + 'etc. — allow-list-filtered from the OpenNGC Identifiers column) for combobox '
      + 'search. Sharpless is NOT in OpenNGC itself; Sh2 aliases and curated common '
      + 'names for overlap rows are merged in from the VII/20+SIMBAD crosswalk '
      + `(lib/sharpless_crosswalk.mjs); Sharpless-ONLY objects live in ${outputs.sharpless}.`,
    mag_ceiling: bake.magCeiling,
    capturable_count: capturableCount,
    scopes: Object.fromEntries(Object.entries(scopes).map(([k, s]) => [k, s.label])),
    date_parsed: todayISO(),
  },
}, 1);
report('deepsky',
  `${num(objects.length)} objects · ${num(capturableCount)} capturable · ${sh2Aliased} Sh2-aliased`,
  checkCount(), written);
