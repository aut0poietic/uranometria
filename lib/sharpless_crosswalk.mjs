// Shared dedup core for parsers/sharpless.mjs and parsers/deepsky.mjs. Reads only
// raws, never either bake, so the two parsers run in any order. Raw OpenNGC
// specifically: the bake's null-mag rule drops rows that must still never be re-keyed.
//
// An Sh2 object is an overlap if ANY layer hits:
//   A. SIMBAD lists a plain NGC/IC/Messier id.
//   B. A shared LBN/LDN/Ced/RCW/Gum/vdB id appears in an OpenNGC row's Identifiers
//      (the Wizard: Sh2-142 ↔ LBN 511 ↔ NGC 7380).
//   C. An OpenNGC Identifiers entry names `SH 2-<n>` directly (the Cave).
//   D. Positional proximity — a FLAG, not a verdict. Every flagged object must be
//      curated overlap/distinct; uncurated flags and stale entries both abort.
// A alone misses M42, M16 and the Crescent, which is why B–D exist.

import { parseCsv, sexagesimalToDegrees, precessB1950toJ2000 } from './shared.mjs';
import { readRawText, readCuration } from './fetch.mjs';

/** The forms people type. Matching is case-insensitive, so this covers SH2-101 too. */
export function sh2Variants(n) {
  return [`Sh2-${n}`, `SH 2-${n}`, `Sharpless ${n}`, `Sharpless${n}`];
}

const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

// "LBN  548" / "lbn 0548" → "LBN 548".
const normId = (s) => s.replace(/\s+/g, ' ').trim().toUpperCase().replace(/^([A-Z]+) 0+(\d)/, '$1 $2');

const sepArcmin = (ra1, de1, ra2, de2) => {
  const r = Math.PI / 180;
  const a = Math.sin(((de2 - de1) * r) / 2) ** 2
    + Math.cos(de1 * r) * Math.cos(de2 * r) * Math.sin(((ra2 - ra1) * r) / 2) ** 2;
  return ((2 * Math.asin(Math.sqrt(a))) / r) * 60;
};

/**
 * Returns:
 *   sharpless — all 313 VII/20 rows, J2000 ra/dec baked on
 *   kept      — the Sharpless-only subset
 *   overlaps  — [{n, via, match}] excluded pairs
 *   simbadIds — Map n → [identifier strings]
 *   simbadPos — Map n → {ra, dec} SIMBAD J2000
 *   curation  — the parsed curation file
 */
export function loadSharplessCrosswalk() {
  // Byte columns per the VizieR ReadMe.
  const fw = (line, a, b) => line.slice(a - 1, b).trim();
  const sharpless = readRawText('sharpless')
    .split(/\r?\n/).filter((l) => l.trim().length > 0)
    .map((l) => {
      const sign = fw(l, 42, 42) === '-' ? -1 : 1;
      const row = {
        n: Number(fw(l, 1, 4)),
        // 1950.0 position; the 1900.0 one at 21-34 is ignored.
        ra1950: (Number(fw(l, 35, 36)) + Number(fw(l, 37, 38)) / 60 + Number(fw(l, 39, 41)) / 10 / 3600) * 15,
        dec1950: sign * (Number(fw(l, 43, 44)) + Number(fw(l, 45, 46)) / 60 + Number(fw(l, 47, 48)) / 3600),
        diam: Number(fw(l, 49, 52)),   // max angular diameter, arcmin
        bright: Number(fw(l, 55, 55)), // 1 faintest … 3 brightest
      };
      return { ...row, ...precessB1950toJ2000(row.ra1950, row.dec1950) };
    });

  // Keyed by the padded "SH  2-101" form; sub-region rows ("SH 2-127 A") are skipped.
  const unquote = (s) => s.replace(/^"|"$/g, '');
  const plainSh2 = (s) => {
    const m = unquote(s).match(/^SH +2-(\d+)$/);
    return m ? Number(m[1]) : null;
  };
  const simbadIds = new Map();
  for (const line of readRawText('simbadIdents').split('\n').slice(1)) {
    if (!line.trim()) continue;
    const m = line.match(/^"(.*)","(.*)"\s*$/);
    const n = m && plainSh2(m[1]);
    if (n === null || n === false) continue;
    if (!simbadIds.has(n)) simbadIds.set(n, []);
    simbadIds.get(n).push(unquote(m[2]).replace(/\s+/g, ' ').trim());
  }
  const simbadPos = new Map();
  for (const line of readRawText('simbadPos').split('\n').slice(1)) {
    if (!line.trim()) continue;
    const c = line.split(',');
    const n = plainSh2(c[0]);
    if (n !== null && Number.isFinite(Number(c[1]))) {
      simbadPos.set(n, { ra: Number(c[1]), dec: Number(c[2]) });
    }
  }

  const ngcRows = [
    ...parseCsv(readRawText('openngc'), ';'),
    ...parseCsv(readRawText('openngcAddendum'), ';'),
  ];
  const openngcIds = new Map();
  for (const r of ngcRows) {
    for (const raw of (r.Identifiers || '').split(',')) {
      const k = normId(raw);
      if (k && !openngcIds.has(k)) openngcIds.set(k, r.Name);
    }
  }
  const NEBULAR = new Set(['Neb', 'EmN', 'HII', 'RfN', 'SNR', 'Cl+N', 'DrkN']);
  const nebRows = ngcRows
    .filter((r) => NEBULAR.has(r.Type) && r.RA && r.Dec)
    .map((r) => ({
      name: r.Name,
      ra: sexagesimalToDegrees(r.RA, true),
      dec: sexagesimalToDegrees(r.Dec, false),
      majAx: r.MajAx !== '' ? Number(r.MajAx) : 0,
    }));

  const curation = readCuration();
  const SHARED_ID = /^(LBN|LDN|CED|RCW|GUM|VDB) \d+$/;
  const overlaps = [];
  const kept = [];
  const flaggedResolved = new Set();

  for (const s of sharpless) {
    const ids = simbadIds.get(s.n) ?? [];
    const direct = ids.find((i) => /^(NGC|IC|M) \d+$/.test(i));                        // layer A
    const shared = ids.map(normId).find((i) => SHARED_ID.test(i) && openngcIds.has(i)); // layer B
    const named = openngcIds.get(`SH 2-${s.n}`);                                        // layer C
    if (direct || shared || named) {
      overlaps.push({
        n: s.n,
        via: direct ? 'simbad-id' : shared ? 'shared-cross-id' : 'openngc-identifiers',
        match: direct ?? (shared ? openngcIds.get(shared) : named),
      });
      continue;
    }
    // Layer D: the curation file must decide.
    const near = nebRows.find((r) => {
      const radius = Math.min(Math.max(s.diam, r.majAx) / 2, 90) + 10; // arcmin, capped for degree-scale extents
      return sepArcmin(s.ra, s.dec, r.ra, r.dec) < radius;
    });
    if (near) {
      const cur = curation.resolutions[String(s.n)];
      if (!cur) fail(`Sh2-${s.n} positionally flags ${near.name} but has no entry in sharpless_curation.json — curate it (overlap/distinct).`);
      flaggedResolved.add(String(s.n));
      if (cur.resolution === 'overlap') {
        overlaps.push({ n: s.n, via: 'curated', match: cur.match });
        continue;
      }
      if (cur.resolution !== 'distinct') fail(`Sh2-${s.n}: unknown curation resolution "${cur.resolution}".`);
    }
    kept.push(s);
  }

  // No longer flagging means the raw data or the flag rule moved; re-review.
  for (const key of Object.keys(curation.resolutions)) {
    if (!flaggedResolved.has(key)) {
      fail(`sharpless_curation.json entry for Sh2-${key} is stale: the object no longer positionally flags anything.`);
    }
  }

  return { sharpless, kept, overlaps, simbadIds, simbadPos, curation };
}
