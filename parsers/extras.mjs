// curation/extras.json → catalog-extras.json
//
// The escape hatch for real targets no fetched source carries. The Propeller
// (DWB 111 / Simeis 57) is the trigger case: SIMBAD indexes the identifiers but
// VizieR publishes no DWB table, so there is nothing to pin a sha256 to.
//
// Hand-entered and therefore the least authoritative output here — a separate
// file, not rows smuggled into a bake that carries real provenance end to end.
// Every entry must document where its values came from; the checks enforce it.

import { bakeXYZ, round, check, checkCount, property, todayISO, writeOutput } from '../lib/shared.mjs';
import { readExtras } from '../lib/fetch.mjs';
import { note, report } from '../lib/ui.mjs';
import { scopes, RESOLVE_PX, outputs } from '../config.mjs';

const REQUIRED_PROVENANCE = ['position', 'size_arcmin', 'designations', 'type'];

const { objects: entries } = readExtras();

const objects = entries
  .map((e) => ({
    id: e.id,
    name: e.name,
    messier: null,
    designations: [e.id, ...e.designations].filter((d, i, a) =>
      a.findIndex((x) => x.toLowerCase() === d.toLowerCase()) === i),
    ra: round(e.ra, 6),
    dec: round(e.dec, 6),
    ...bakeXYZ(e.ra, e.dec),
    type: e.type,
    mag: null,
    size_arcmin: e.size_arcmin,
    surf_br: null,
    difficulty: e.difficulty,
    capturable: true,
    // Same degradation parsers/deepsky.mjs applies to size-less rows.
    resolves_on: e.size_arcmin === null ? [] : Object.entries(scopes)
      .filter(([, sc]) => (e.size_arcmin * 60) / sc.pxScale >= RESOLVE_PX)
      .map(([k]) => k),
    fits_fov: e.size_arcmin === null ? Object.keys(scopes) : Object.entries(scopes)
      .filter(([, sc]) => e.size_arcmin <= sc.fovShortArcmin)
      .map(([k]) => k),
    redshift: null,
    curated: true,
  }))
  .sort((a, b) => a.ra - b.ra);

property('every entry is fully specified and documented', entries, (e) => {
  for (const f of ['id', 'name', 'type', 'difficulty']) {
    if (!e[f]) return `${e.id ?? '?'}: missing "${f}"`;
  }
  if (!Number.isFinite(e.ra) || !Number.isFinite(e.dec)) return `${e.id}: non-numeric position`;
  if (e.ra < 0 || e.ra > 360 || e.dec < -90 || e.dec > 90) return `${e.id}: coords out of range`;
  if (!(e.size_arcmin === null || Number.isFinite(e.size_arcmin))) return `${e.id}: bad size_arcmin`;
  if (!Array.isArray(e.designations) || e.designations.length === 0) return `${e.id}: no designations`;
  if (!e.provenance) return `${e.id}: no provenance block — every curated value must say where it came from`;
  for (const f of REQUIRED_PROVENANCE) {
    if (!e.provenance[f]) return `${e.id}: provenance is missing "${f}"`;
  }
  return true;
});

property('all objects on the unit sphere', objects, (o) => {
  const err = Math.abs(o.x ** 2 + o.y ** 2 + o.z ** 2 - 1);
  return err < 1e-6 || `|x²+y²+z²−1| = ${err} for ${o.id}`;
});

check(new Set(objects.map((o) => o.id)).size === objects.length,
  `${objects.length} entries, all ids unique`);

const propeller = objects.find((o) => o.id === 'DWB111');
check(propeller && propeller.name === 'Propeller Nebula'
  && Math.abs(propeller.ra - 304.0) < 0.1 && Math.abs(propeller.dec - 43.67) < 0.1
  && propeller.designations.some((d) => /^Simeis\s*57$/i.test(d)),
  `Propeller (DWB111) present: RA ${propeller?.ra}, Dec ${propeller?.dec}, ${JSON.stringify(propeller?.designations)}`);

note('curated entries (no fetched source carries these):');
for (const o of objects) note(`  ${o.id} — ${o.name} [${o.designations.join(', ')}]`);

const written = writeOutput(outputs.extras, {
  objects,
  count: objects.length,
  metadata: {
    source: 'curation/extras.json — hand-entered, NOT derived from a pinned source',
    note: 'Real imaging targets no fetched catalog carries, usually because the '
      + 'catalog behind them was never published as a machine-readable table. '
      + 'Every value is hand-curated and every entry documents its own provenance; '
      + 'these are the least authoritative rows this repo emits and are kept in a '
      + 'separate file so consumers can weight them accordingly. Positions are '
      + 'J2000; unit-sphere x/y/z, resolves_on and fits_fov derived at bake like '
      + 'everywhere else.',
    provenance: Object.fromEntries(entries.map((e) => [e.id, e.provenance])),
    date_parsed: todayISO(),
  },
}, 1);
report('extras',
  `${objects.length} curated ${objects.length === 1 ? 'target' : 'targets'}`,
  checkCount(), written);
