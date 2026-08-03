// Stellarium `modern` skyculture → constellations.json
//
// RUN FIRST: parsers/stars.mjs reads this output for its union set.
//
// `lines` are polylines (ordered HIP arrays) → expanded to N−1 segments.

import { check, checkCount, property, todayISO, writeOutput } from '../lib/shared.mjs';
import { readRawText } from '../lib/fetch.mjs';
import { num, report } from '../lib/ui.mjs';
import { sources, outputs } from '../config.mjs';

const sky = JSON.parse(readRawText('stellarium'));

const constellations = sky.constellations.map((c) => {
  const abbr = c.id.trim().split(/\s+/).at(-1);
  const name = c.common_name?.native ?? c.common_name?.english ?? abbr;
  const lines = [];
  for (const poly of c.lines) {
    for (let i = 0; i < poly.length - 1; i++) {
      lines.push({ star1: poly[i], star2: poly[i + 1] });
    }
  }
  return { name, abbr, lines };
});

check(constellations.length === 88, `88 constellations parsed (got ${constellations.length})`);

property('abbreviations are 2–4 characters', constellations,
  (c) => (c.abbr.length >= 2 && c.abbr.length <= 4) || `${c.name} has abbr "${c.abbr}"`);

const allHips = new Set();
const allSegments = [];
for (const c of constellations) {
  for (const seg of c.lines) {
    allHips.add(seg.star1); allHips.add(seg.star2);
    allSegments.push({ ...seg, abbr: c.abbr });
  }
}
property('segment endpoints are positive HIP ints', allSegments,
  ({ star1, star2, abbr }) => (Number.isInteger(star1) && Number.isInteger(star2)
    && star1 > 0 && star2 > 0) || `${abbr}: ${star1} → ${star2}`);

const segments = allSegments.length;
check(segments === 695, `695 expanded segments (got ${segments})`);
check(allHips.size === 710, `710 unique HIP ids in union set (got ${allHips.size})`);
const dupNames = constellations.length - new Set(constellations.map((c) => c.abbr)).size;
check(dupNames === 0, 'constellation abbreviations are unique');

const written = writeOutput(outputs.constellations, {
  constellations,
  count: constellations.length,
  metadata: {
    source: sources.stellarium.provenance,
    segments,
    unique_hip_ids: allHips.size,
    date_parsed: todayISO(),
  },
}, 1);

report('constellations',
  `${constellations.length} constellations · ${num(segments)} segments · ${num(allHips.size)} HIPs`,
  checkCount(), written);
