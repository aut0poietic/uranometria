// OpenNGC → catalog-opengc.json
//
// A data source, not a render layer: backs a subject picker and a spatial
// neighborhood lookup. Full sky, no declination gate. Capturability is BAKED,
// not filtered — consumers filter downstream.

import { parseCsv, sexagesimalToDegrees, bakeXYZ, round, check, checkCount, property, todayISO, writeOutput } from '../lib/shared.mjs';
import { readRawText, readCommonNames } from '../lib/fetch.mjs';
import { num, note, report } from '../lib/ui.mjs';
import { loadSharplessCrosswalk, sh2Variants } from '../lib/sharpless_crosswalk.mjs';
import { bake, scopes, RESOLVE_PX, sources, outputs, TYPE_MAP } from '../config.mjs';

// Drops stars, doubles, duplicates, non-existent, associations, novae, and dark
// nebulae (no emission to stack) — except listed rows, below.
const KEEP = new Set(['G', 'OCl', 'GPair', 'GCl', 'PN', 'Neb', 'HII', 'Cl+N',
  'RfN', 'GTrpl', 'GGroup', 'SNR', 'EmN']);

// Messier objects the type filter would otherwise drop: M24 is a Milky Way star
// cloud (*Ass), M40 a double star, M73 a four-star asterism. People search the
// Messier list expecting all 110.
const TYPE_EXEMPT = new Set(['IC4715', 'M040', 'NGC6994']);

// M102 is disputed (M101 vs NGC 5866) and OpenNGC leaves its M column empty.
// Same mainstream identification parsers/messier.mjs adopts.
const MESSIER_BY_ID = { NGC5866: 'M102' };

const EXTENDED = new Set(['G', 'GPair', 'GTrpl', 'GGroup', 'Neb', 'RfN']); // want resolved structure
const EMISSION = new Set(['EmN', 'HII', 'Cl+N']);                          // duo-band filter → deeper
const COMPACT = new Set(['GCl', 'PN', 'OCl', 'SNR']);                      // fine when small/bright

// Diffuse nebulae often carry no integrated V/B magnitude; dropping them cost 159
// real NGC/IC nebulae (Pacman, Seagull, Thor's Helmet, the Cave). Nebular types
// survive a null mag; the ~500 mag-less galaxy pairs/clusters still drop.
const NULLMAG_EXEMPT = new Set(['Neb', 'EmN', 'HII', 'RfN', 'SNR', 'Cl+N']);

// A row people search for — it has a common name (upstream or curated) or a
// Caldwell number — skips the magnitude rules, and these types also get past
// KEEP. Without it the bake lost the Jewel Box, Hyades, Southern Pleiades, Double
// Cluster, Horsehead, Coalsack and Stephan's Quintet to a missing magnitude.
const LISTED_TYPES = new Set(['*Ass', 'DrkN']);
// Clusters and dark nebulae with no magnitude reach the bake only as listed rows.
const NULLMAG_LISTED = new Set(['OCl', '*Ass', 'DrkN']);

const isCaldwell = (row) => /^C\d{3}$/.test(row.Name)
  || (row.Identifiers ?? '').split(',').some((id) => /^C\s+\d+$/.test(id.trim()));

const numOrNull = (v) => (v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

// The Identifiers column is mostly survey cruft (2MASX, PGC, SDSS, IRAS...).
// Keep only what an imager would search by. Extend freely; matching is case-insensitive.
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

// "PREFIX 0NN" → spaced and compact, so "C 11" and "C11" both match.
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

// Ids are zero-padded (NGC0224); people type "NGC224". Emit both.
function idVariants(name) {
  const m = name.match(/^(NGC|IC)0*(\d+)([A-Za-z].*)?$/);
  if (!m) return [name];
  const bare = `${m[1]}${m[2]}${m[3] ?? ''}`;
  return name === bare ? [name] : [name, bare];
}

// OpenNGC's 'Common names' is a comma-separated list ordered alphabetically,
// not by usage, so its first entry is regularly the name nobody says: M17 leads
// with "Checkmark Nebula" ahead of Swan and Omega, M11 with a French phrase.
// The title comes from curation where the alphabet gets it wrong; every other
// name — upstream or curated — becomes a searchable designation.
const commonNames = readCommonNames();
const upstreamNamed = new Set();  // ids OpenNGC names at all — for the staleness check
const nameAliasedIds = new Set(); // ids that kept a second name as a searchable alias

const rejectedSeen = new Set();    // `${id}|${name}` actually dropped — for the staleness check

function namesFor(row) {
  const all = (row['Common names'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (all.length) upstreamNamed.add(row.Name);
  const rejected = new Set((commonNames.rejected[row.Name]?.names ?? []).map((n) => n.toLowerCase()));
  const upstream = all.filter((n) => {
    if (!rejected.has(n.toLowerCase())) return true;
    rejectedSeen.add(`${row.Name}|${n.toLowerCase()}`);
    return false;
  });
  const name = commonNames.preferred[row.Name]?.name ?? commonNames.named[row.Name]?.name ?? upstream[0] ?? null;
  const key = (name ?? '').toLowerCase();
  // Curated first: a cased "Omega Nebula" then absorbs OpenNGC's "omega Nebula"
  // in the case-insensitive dedupe downstream.
  const aliases = [...(commonNames.extra_aliases[row.Name] ?? []), ...upstream]
    .filter((n) => n.toLowerCase() !== key);
  return { name, aliases };
}

function designationsFor(row, messier, nameAliases) {
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
  nameAliases.forEach(add); // last: ids stay at the head of the list
  return seen;
}

function capturable(type, mag) {
  if (mag === null) return NULLMAG_EXEMPT.has(type) || NULLMAG_LISTED.has(type);
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
  if (mag === null) return type === 'OCl' || type === '*Ass' ? 'easy' : 'dark';
  // Common for clusters: fall back to type + integrated mag.
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
  if (sizeArcmin === null) return Object.keys(scopes);
  return Object.entries(scopes)
    .filter(([, s]) => sizeArcmin <= s.fovShortArcmin)
    .map(([k]) => k);
}

function toObject(row) {
  const type = TYPE_MAP[row.Type] ?? 'other';
  const { name, aliases } = namesFor(row);
  const listed = name !== null || isCaldwell(row);
  if (!KEEP.has(row.Type) && !TYPE_EXEMPT.has(row.Name) && !(listed && LISTED_TYPES.has(row.Type))) return null;
  if (!row.RA || !row.Dec) return null;
  const mag = numOrNull(row['V-Mag']) ?? numOrNull(row['B-Mag']);
  if (!listed && mag === null && !NULLMAG_EXEMPT.has(row.Type)) return null;
  if (!listed && mag !== null && mag > bake.magCeiling) return null;
  if (aliases.length) nameAliasedIds.add(row.Name);

  const ra = sexagesimalToDegrees(row.RA, true);
  const dec = sexagesimalToDegrees(row.Dec, false);
  const size = numOrNull(row.MajAx);
  const surfBr = numOrNull(row.SurfBr);
  const messier = row.M ? `M${Number(row.M)}` : MESSIER_BY_ID[row.Name] ?? null;

  return {
    id: row.Name,
    name,
    messier,
    designations: designationsFor(row, messier, aliases),
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

// Addendum can re-list a handful; first wins. RA order for spatial locality.
const byName = new Map();
for (const row of rows) {
  const obj = toObject(row);
  if (obj && !byName.has(obj.id)) byName.set(obj.id, obj);
}
const objects = [...byName.values()].sort((a, b) => a.ra - b.ra);

// Canonical-id stability: a resolved Sh2 object gains its designation ON the
// existing row (the Bubble += Sh2-162, never a second row), plus a curated name
// where OpenNGC has none. Fill-when-empty only; an OpenNGC name always wins.
// Pairs whose row is not in this bake are reported, not failed.
const { overlaps, curation } = loadSharplessCrosswalk();
const byMessier = new Map(objects.filter((o) => o.messier).map((o) => [o.messier, o]));
// Match ids arrive mixed ("NGC 281", "NGC6334", "M 8", "C009").
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

check(objects.length > 7500 && objects.length < 9500,
  `object count in expected band for mag ≤ ${bake.magCeiling} (got ${objects.length})`);

property('all objects on the unit sphere, coords in range', objects, (o) => {
  const err = Math.abs(o.x ** 2 + o.y ** 2 + o.z ** 2 - 1);
  if (err >= 1e-6) return `|x²+y²+z²−1| = ${err} for ${o.id}`;
  if (o.ra < 0 || o.ra > 360 || o.dec < -90 || o.dec > 90) return `coordinate out of range for ${o.id}`;
  return true;
});

const crab = byName.get('NGC1952');
check(crab && crab.messier === 'M1' && crab.type === 'supernova_remnant'
  && Math.abs(crab.ra - 83.6332) < 0.01 && Math.abs(crab.dec - 22.0145) < 0.01,
  `Crab Nebula (NGC1952=M1) present: RA ${crab?.ra}, Dec ${crab?.dec}, mag ${crab?.mag}`);

const m31 = byName.get('NGC0224');
check(m31 && m31.capturable && m31.resolves_on.includes('s50'),
  `M31 (NGC0224) capturable and resolves on S50`);

const messierPresent = new Set(objects.filter((o) => o.messier).map((o) => o.messier));
const messierMissing = Array.from({ length: 110 }, (_, i) => `M${i + 1}`)
  .filter((m) => !messierPresent.has(m));
check(messierMissing.length === 0,
  `all 110 Messier objects survive the type filter${messierMissing.length ? ` (missing ${messierMissing.join(', ')})` : ''}`);
const m24 = byName.get('IC4715');
check(m24 && m24.messier === 'M24' && m24.designations.includes('M24'),
  `M24 (IC4715, *Ass) kept and searchable as "M24" (${JSON.stringify(m24?.designations)})`);

check(objects.every((o) => o.designations.length >= 1),
  'property: every object carries at least its own id in designations');
check(m31.designations.includes('NGC224'),
  `M31 designations include un-padded "NGC224" for search (${JSON.stringify(m31.designations)})`);
// OpenNGC carries Caldwell/LBN but NOT Sharpless; that arrives via the merge.
const bubble = byName.get('NGC7635');
check(bubble
  && bubble.designations.some((d) => /^LBN\s*548$/i.test(d))
  && bubble.designations.some((d) => /^caldwell\s*11$/i.test(d))
  && bubble.designations.includes('Sh2-162'),
  `Bubble (NGC7635) carries LBN 548 + Caldwell 11 + merged Sh2-162 (${JSON.stringify(bubble?.designations)})`);
const withAlias = objects.filter((o) => o.designations.length > 1);
check(withAlias.length > 40,
  `${withAlias.length} objects carry ≥1 cross-catalog alias beyond their own id`);

const wizard = byName.get('NGC7380');
check(wizard && wizard.name === 'Wizard Nebula' && wizard.designations.includes('Sh2-142'),
  `Wizard (NGC7380) named + carries Sh2-142 (${JSON.stringify(wizard?.name)}, ${JSON.stringify(wizard?.designations)})`);
const heart = byName.get('IC1805');
check(heart && heart.name === 'Heart Nebula' && heart.designations.includes('Sh2-190'),
  `Heart (IC1805) named + carries Sh2-190`);
const orion = byName.get('NGC1976');
check(orion && orion.name === 'Orion Nebula' && orion.designations.includes('Great Orion Nebula')
  && orion.designations.includes('Sh2-281'),
  `Orion (NGC1976) titled from curation, keeps "Great Orion Nebula" searchable, gains Sh2-281`);

// Common names: curation decides the title, everything else stays searchable.
const staleNames = [commonNames.preferred, commonNames.named, commonNames.rejected, commonNames.extra_aliases]
  .flatMap(Object.keys)
  .filter((id) => !byName.has(id));
check(staleNames.length === 0,
  `every common_names.json id is in the bake${staleNames.length ? ` (stale: ${staleNames.join(', ')})` : ''}`);
const unneeded = Object.keys(commonNames.preferred).filter((id) => !upstreamNamed.has(id));
check(unneeded.length === 0,
  `every curated title overrides an actual OpenNGC name${unneeded.length ? ` (no upstream name: ${unneeded.join(', ')})` : ''}`);
const nowNamed = Object.keys(commonNames.named).filter((id) => upstreamNamed.has(id));
check(nowNamed.length === 0,
  `every \`named\` row still has no OpenNGC name${nowNamed.length ? ` (move to preferred: ${nowNamed.join(', ')})` : ''}`);
const unrejected = Object.entries(commonNames.rejected)
  .flatMap(([id, { names }]) => names.map((n) => `${id}|${n.toLowerCase()}`))
  .filter((k) => !rejectedSeen.has(k));
check(unrejected.length === 0,
  `every rejected name is still in OpenNGC${unrejected.length ? ` (gone upstream: ${unrejected.join(', ')})` : ''}`);

const m17 = byName.get('NGC6618');
check(m17 && m17.name === 'Swan Nebula'
  && ['Omega Nebula', 'Horseshoe Nebula', 'Lobster Nebula', 'Checkmark Nebula']
    .every((n) => m17.designations.includes(n))
  && !m17.designations.includes('omega Nebula'),
  `M17 titled "Swan Nebula", searchable as Omega/Horseshoe/Lobster/Checkmark (${JSON.stringify(m17?.designations)})`);

check(nameAliasedIds.size >= 20,
  `${nameAliasedIds.size} rows carry an alternate common name as a searchable alias`);
check(objects.length === byName.size,
  `merge added no rows: still ${objects.length} objects`);
check(sh2Aliased >= 25 && sh2Aliased + sh2Unbaked.length === overlaps.length,
  `${sh2Aliased} rows gained an Sh2 alias (${sh2Named} also named); ${sh2Unbaked.length} pairs point at rows not in this bake`);
// Every overlap target clears the ceiling, so a failure here means it moved below 13.1 (NGC 6842).
check(sh2Unbaked.length === 0,
  `every Sh2 overlap pair lands on a baked row${sh2Unbaked.length ? ` (unbaked: ${sh2Unbaked.join(', ')})` : ''}`);

// Pacman/Seagull/Thor's Helmet are named from curation; Running Man and the Cave
// keep their OpenNGC names.
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
const nebularTypes = new Set([...NULLMAG_EXEMPT].map((t) => TYPE_MAP[t]));
const nullMag = objects.filter((o) => o.mag === null && nebularTypes.has(o.type));
check(nullMag.length > 100 && nullMag.length < 250 && nullMag.every((o) => o.capturable && o.difficulty !== 'easy'),
  `${nullMag.length} mag-less nebulae admitted under the exemption, all capturable, none classified easy`);

// Listed rows: a common name or Caldwell number beats the magnitude and type gates.
const caldwellPresent = new Set(objects.flatMap((o) => [o.id, ...o.designations])
  .map((d) => d.match(/^(?:Caldwell |C)(\d+)$/)?.[1]).filter(Boolean).map(Number));
const caldwellMissing = Array.from({ length: 109 }, (_, i) => i + 1).filter((c) => !caldwellPresent.has(c));
check(caldwellMissing.length === 0,
  `all 109 Caldwell objects present${caldwellMissing.length ? ` (missing C${caldwellMissing.join(', C')})` : ''}`);
property('listed showpieces present despite no magnitude or an excluded type', [
  ['IC2602', 'open_cluster'], ['NGC4755', 'open_cluster'], ['C041', 'open_cluster'], ['Mel111', 'open_cluster'],
  ['C014', 'stellar_association'], ['B033', 'dark_nebula'], ['C099', 'dark_nebula'], ['HCG092', 'galaxy_group'],
], ([id, type]) => {
  const o = byName.get(id);
  return (o && o.name && o.type === type) || `${id}: ${JSON.stringify(o)}`;
});
const jewel = byName.get('NGC4755');
check(jewel.capturable && jewel.difficulty === 'easy',
  `mag-less showpiece clusters are capturable and easy (Jewel Box: ${jewel.capturable}, ${jewel.difficulty})`);

const ghost = byName.get('IC0063');
check(byName.get('IC0059')?.name === 'Ghost of Cassiopeia' && ghost?.name === 'Ghost of Cassiopeia'
  && ['Sh2-185', 'LBN 622', 'LBN 623'].every((d) => ghost.designations.includes(d)),
  `Ghost of Cassiopeia: IC 59 + IC 63 named, IC 63 searchable as Sh2-185/LBN 622/LBN 623 (${JSON.stringify(ghost?.designations)})`);
const flame = byName.get('NGC2024');
const ic434 = byName.get('IC0434');
check(flame?.name === 'Flame Nebula' && ic434 && ic434.name !== 'Flame Nebula'
  && !ic434.designations.includes('Flame Nebula') && ic434.designations.includes('Horsehead Nebula'),
  `Flame is NGC 2024, not IC 434; IC 434 searchable as Horsehead (${JSON.stringify(ic434?.name)})`);
check(byName.get('IC0443')?.name === 'Jellyfish Nebula' && byName.get('IC0443').designations.includes('Gem A'),
  `IC 443 titled Jellyfish Nebula, "Gem A" stays searchable`);

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
      + 'Messier, NGC/IC cross-refs, amateur cross-catalogs — Caldwell, LBN, '
      + 'etc. — allow-list-filtered from the OpenNGC Identifiers column, and every '
      + 'common name that is not the display `name`) for combobox search. OpenNGC '
      + 'orders its common names alphabetically rather than by usage, so the title '
      + 'comes from curation/common_names.json where the first entry is the wrong '
      + 'one (M17 is the Swan, not the Checkmark). Rows with a common name or a '
      + 'Caldwell number bypass mag_ceiling. Sharpless is NOT in OpenNGC '
      + 'itself; Sh2 aliases and curated common '
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
