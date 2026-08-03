// Sharpless (VizieR VII/20) → catalog-sharpless.json
//
// Sharpless-ONLY HII regions as `SH2-<n>` rows. Objects OpenNGC already carries
// are excluded and keep their NGC/IC key — re-keying would orphan downstream
// bindings — gaining their Sh2 alias in the parsers/deepsky.mjs merge instead.
// The dedup lives in lib/sharpless_crosswalk.mjs.
//
// Field rules, because the deep-sky mag-driven logic would misfire on soft mags
// and degree-scale sizes: mag/surf_br null, capturable true, difficulty from the
// brightness class. An empty fits_fov is mosaic territory, never coerced.

import { bakeXYZ, round, check, checkCount, property, todayISO, writeOutput } from '../lib/shared.mjs';
import { note, report } from '../lib/ui.mjs';
import { loadSharplessCrosswalk, sh2Variants } from '../lib/sharpless_crosswalk.mjs';
import { scopes, RESOLVE_PX, sources, outputs } from '../config.mjs';

const { sharpless, kept, overlaps, simbadIds, simbadPos, curation } = loadSharplessCrosswalk();

const sepArcmin = (ra1, de1, ra2, de2) => {
  const r = Math.PI / 180;
  const a = Math.sin(((de2 - de1) * r) / 2) ** 2
    + Math.cos(de1 * r) * Math.cos(de2 * r) * Math.sin(((ra2 - ra1) * r) / 2) ** 2;
  return ((2 * Math.asin(Math.sqrt(a))) / r) * 60;
};

// Own key, plus SIMBAD's plain numbered LBN/LDN/Ced/RCW/Gum/vdB ids (galactic-
// coordinate forms and survey cruft dropped), plus curated ids no source supplies.
const PREFIX_CASE = { LBN: 'LBN', LDN: 'LDN', CED: 'Ced', RCW: 'RCW', GUM: 'Gum', VDB: 'vdB' };
function designationsFor(s) {
  const seen = [];
  const add = (v) => {
    if (v && !seen.some((x) => x.toLowerCase() === v.toLowerCase())) seen.push(v);
  };
  [`SH2-${s.n}`, ...sh2Variants(s.n)].forEach(add); // "Sh2-N" collapses into the id form
  for (const raw of simbadIds.get(s.n) ?? []) {
    const id = raw.replace(/\s+/g, ' ').trim().toUpperCase().replace(/^([A-Z]+) 0+(\d)/, '$1 $2');
    const m = id.match(/^([A-Z]+) (\d+)$/);
    if (m && PREFIX_CASE[m[1]]) {
      add(`${PREFIX_CASE[m[1]]} ${m[2]}`);
      add(`${PREFIX_CASE[m[1]]}${m[2]}`);
    }
  }
  for (const id of curation.extra_designations?.[String(s.n)]?.ids ?? []) {
    add(id);
    const compact = id.replace(/\s+/g, '');
    if (compact !== id) add(compact);
  }
  return seen;
}

const objects = kept
  .map((s) => ({
    id: `SH2-${s.n}`,
    name: curation.common_names[String(s.n)] ?? null,
    messier: null,
    designations: designationsFor(s),
    ra: round(s.ra, 6),
    dec: round(s.dec, 6),
    ...bakeXYZ(s.ra, s.dec),
    type: 'hii_region',
    mag: null,
    size_arcmin: s.diam,
    surf_br: null,
    difficulty: s.bright === 3 ? 'moderate' : 'dark',
    capturable: true,
    resolves_on: Object.entries(scopes)
      .filter(([, sc]) => (s.diam * 60) / sc.pxScale >= RESOLVE_PX)
      .map(([k]) => k),
    fits_fov: Object.entries(scopes)
      .filter(([, sc]) => s.diam <= sc.fovShortArcmin)
      .map(([k]) => k),
    redshift: null,
  }))
  .sort((a, b) => a.ra - b.ra);

check(sharpless.length === 313, `VII/20 parsed in full (313 rows, got ${sharpless.length})`);

// Offsets vs SIMBAD J2000 should be centroid noise, not a frame error.
const seps = kept.filter((s) => simbadPos.has(s.n))
  .map((s) => sepArcmin(s.ra, s.dec, simbadPos.get(s.n).ra, simbadPos.get(s.n).dec))
  .sort((a, b) => a - b);
check(seps.length > 200 && seps[Math.floor(seps.length / 2)] < 3,
  `precession vs SIMBAD J2000: median offset ${seps[Math.floor(seps.length / 2)].toFixed(2)}′ over ${seps.length} objects`);

property('all objects on the unit sphere, ids well-formed', objects, (o) => {
  const err = Math.abs(o.x ** 2 + o.y ** 2 + o.z ** 2 - 1);
  if (err >= 1e-6) return `|x²+y²+z²−1| = ${err} for ${o.id}`;
  if (o.ra < 0 || o.ra > 360 || o.dec < -90 || o.dec > 90) return `bad coords for ${o.id}`;
  if (!/^SH2-\d+$/.test(o.id)) return `malformed id "${o.id}"`;
  return true;
});

const tulip = objects.find((o) => o.id === 'SH2-101');
check(tulip && tulip.name === 'Tulip Nebula'
  && Math.abs(tulip.ra - 299.96) < 0.2 && Math.abs(tulip.dec - 35.26) < 0.2
  && tulip.designations.some((d) => /^Ced\s*173$/i.test(d))
  && tulip.designations.some((d) => /^LBN\s*168$/i.test(d)),
  `Tulip (SH2-101) present: RA ${tulip?.ra}, Dec ${tulip?.dec}, ${JSON.stringify(tulip?.designations)}`);

// Known overlaps must NOT mint SH2 rows here.
property('canonical-id stability: Wizard, Cave, Bubble, Lagoon, Orion, Eagle, Crescent all '
  + 'excluded (aliased in the deep-sky merge)',
  [[142, 'Wizard/NGC7380'], [155, 'Cave/C009'], [162, 'Bubble/NGC7635'], [25, 'Lagoon/M8'],
    [281, 'Orion/M42'], [49, 'Eagle/M16'], [105, 'Crescent/NGC6888']],
  ([n, label]) => !objects.some((o) => o.id === `SH2-${n}`)
    || `SH2-${n} (${label}) is an OpenNGC overlap and must not be minted`);

// The Butterfly is only reachable by "IC 1318" because OpenNGC files that id under
// the star gam Cyg; the Ghost has no SIMBAD name at all.
const butterfly = objects.find((o) => o.id === 'SH2-108');
check(butterfly && butterfly.name === 'Butterfly Nebula'
  && butterfly.designations.some((d) => /^IC ?1318$/i.test(d))
  && butterfly.designations.some((d) => /^LBN ?234$/i.test(d)),
  `Butterfly (SH2-108) named + reachable by IC 1318 (${JSON.stringify(butterfly?.designations)})`);
const ghost = objects.find((o) => o.id === 'SH2-136');
check(ghost && ghost.name === 'Ghost Nebula'
  && ghost.designations.some((d) => /^vdB ?141$/i.test(d))
  && Math.abs(ghost.ra - 319.11) < 0.2 && Math.abs(ghost.dec - 68.26) < 0.2,
  `Ghost (SH2-136) named + carries vdB 141: RA ${ghost?.ra}, Dec ${ghost?.dec}`);
property('every curated extra_designations entry landed on a baked row',
  Object.keys(curation.extra_designations ?? {}),
  (n) => {
    const row = objects.find((o) => o.id === `SH2-${n}`);
    if (!row) return `extra_designations["${n}"] targets SH2-${n}, which this bake does not mint`;
    const missing = curation.extra_designations[n].ids
      .filter((id) => !row.designations.some((d) => d.toLowerCase() === id.toLowerCase()));
    return missing.length === 0 || `SH2-${n} is missing curated ids ${JSON.stringify(missing)}`;
  });

const loop = objects.find((o) => o.id === 'SH2-276');
check(loop && loop.name === "Barnard's Loop" && loop.size_arcmin === 1200
  && loop.fits_fov.length === 0 && loop.capturable && loop.mag === null,
  `Barnard's Loop (SH2-276): 1200′, fits no single frame, still capturable, mag null`);
check(objects.every((o) => o.designations.length >= 4 && o.capturable && o.mag === null),
  'property: every object carries its typed designation variants; capturable with null mag');

check(overlaps.length >= 30 && overlaps.length <= 80,
  `${overlaps.length} OpenNGC overlaps excluded and recorded for the alias merge`);
check(objects.length === 313 - overlaps.length && objects.length > 240,
  `${objects.length} Sharpless-only objects baked (313 − ${overlaps.length} overlaps)`);

const byDiff = objects.reduce((m, o) => ((m[o.difficulty] = (m[o.difficulty] || 0) + 1), m), {});
note(`difficulty split: ${JSON.stringify(byDiff)}`);
note('alias pairs (Sh2 → existing OpenNGC row):');
for (const o of overlaps) note(`  Sh2-${o.n} → ${o.match} [${o.via}]`);

const written = writeOutput(outputs.sharpless, {
  objects,
  count: objects.length,
  metadata: {
    source: sources.sharpless.provenance,
    note: 'Sharpless-ONLY HII regions — every Sh2 object with an '
      + 'OpenNGC counterpart (by SIMBAD NGC/IC/M id, shared LBN/Ced-style cross-id, '
      + 'an OpenNGC "SH 2-n" Identifiers entry, or curated positional match) is '
      + 'excluded and keeps its NGC/IC key; it gains its Sh2 alias in the '
      + `${outputs.deepsky} merge. Positions precessed B1950→J2000 at bake; `
      + 'unit-sphere x/y/z. mag and surf_br are null by rule (HII regions), '
      + 'capturable is true by rule, difficulty maps the Sharpless brightness class.',
    overlap_pairs: overlaps.map((o) => ({ sh2: o.n, match: o.match, via: o.via })),
    date_parsed: todayISO(),
  },
}, 1);
report('sharpless',
  `${objects.length} Sh2-only regions · ${overlaps.length} overlaps excluded`,
  checkCount(), written);
