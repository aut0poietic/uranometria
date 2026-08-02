// OpenNGC → messier.json
//
// - OpenNGC is SEMICOLON-delimited; RA/Dec are sexagesimal strings → decimal degrees.
// - The Messier number lives in the zero-padded `M` cross-ref column ("031" = M31).
// - M40 and M45 have no NGC/IC number and live in the addendum file — hence both CSVs.
// - Type codes are normalized to flat types; missing fields → null, never dropped.

import { parseCsv, sexagesimalToDegrees, bakeXYZ, round, check, checkCount, property, todayISO, writeOutput } from '../lib/shared.mjs';
import { readRawText } from '../lib/fetch.mjs';
import { num, note, report } from '../lib/ui.mjs';
import { sources, outputs, TYPE_MAP } from '../config.mjs';

const rows = [
  ...parseCsv(readRawText('openngc'), ';'),
  ...parseCsv(readRawText('openngcAddendum'), ';'),
];
note(`OpenNGC rows parsed: ${num(rows.length)} (NGC + addendum)`);

const numOrNull = (v) => (v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

function toObject(row) {
  if (!row.RA || !row.Dec) return null; // NonEx entries have no position
  const ra = sexagesimalToDegrees(row.RA, true);
  const dec = sexagesimalToDegrees(row.Dec, false);
  return {
    id: row.Name,
    name: row['Common names'] ? row['Common names'].split(',')[0] : null,
    messier: row.M ? `M${Number(row.M)}` : null,
    ra: round(ra, 6),
    dec: round(dec, 6),
    ...bakeXYZ(ra, dec),
    type: TYPE_MAP[row.Type] ?? 'other',
    mag: numOrNull(row['V-Mag']) ?? numOrNull(row['B-Mag']),
    size_arcmin: numOrNull(row.MajAx),
  };
}

// ---- Index every row by name, and collect the Messier backdrop ----
const byName = new Map(); // "NGC0224" / "Mel022" → parsed object
const messier = new Map(); // "M31" → parsed object
for (const row of rows) {
  const obj = toObject(row);
  if (!obj) continue;
  byName.set(obj.id, obj);
  if (obj.messier && obj.type !== 'duplicate' && !messier.has(obj.messier)) {
    messier.set(obj.messier, obj);
  }
}
// M102 is historically disputed (duplicate of M101 vs. NGC 5866); OpenNGC takes
// no position and leaves its M column empty. We adopt the mainstream
// identification M102 = NGC 5866, mapped explicitly here.
if (!messier.has('M102')) {
  const ngc5866 = byName.get('NGC5866');
  if (!ngc5866) { console.error('✗ NGC5866 not found for the M102 mapping'); process.exit(1); }
  messier.set('M102', { ...ngc5866, messier: 'M102' });
}

const messierList = [...messier.values()].sort(
  (a, b) => Number(a.messier.slice(1)) - Number(b.messier.slice(1)));

// ---- Spot checks ----
check(messierList.length === 110, `110 Messier objects found (got ${messierList.length})`);
const m31 = messier.get('M31');
check(m31 && Math.abs(m31.ra - 10.685) < 0.01 && Math.abs(m31.dec - 41.269) < 0.01,
  `M31 sexagesimal→decimal: RA ${m31?.ra} (≈10.685), Dec ${m31?.dec} (≈41.269)`);
const m45 = messier.get('M45');
check(m45 && m45.type === 'open_cluster', `M45 (Pleiades) present via addendum, type ${m45?.type}`);
property('all Messier objects on the unit sphere', messierList, (o) => {
  const err = Math.abs(o.x ** 2 + o.y ** 2 + o.z ** 2 - 1);
  return err < 1e-6 || `|x²+y²+z²−1| = ${err} for ${o.messier}`;
});

const written = writeOutput(outputs.messier, {
  objects: messierList,
  count: messierList.length,
  metadata: {
    source: sources.openngc.provenance,
    note: 'Messier backdrop; catalog positions/types/mags from OpenNGC',
    date_parsed: todayISO(),
  },
}, 1);
report('messier', `${messierList.length} objects · M102 → NGC 5866`, checkCount(), written);
