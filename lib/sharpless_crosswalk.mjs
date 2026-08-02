// Sharpless ↔ OpenNGC crosswalk — the shared dedup core, consumed by BOTH
// parsers/sharpless.mjs (which Sh2 objects are Sharpless-only and may mint
// SH2-<n> keys) and parsers/deepsky.mjs (which existing OpenNGC rows gain Sh2
// aliases + curated names). Living here keeps the two parsers independently
// runnable in any order — each computes the crosswalk from the raws; neither
// ever reads the other's output.
//
// Reads ONLY raw sources plus the curation file — raw OpenNGC, not the baked
// catalog, because the bake's null-mag rule drops rows like the Cave that must
// still never be re-keyed.
//
// Dedup layers (an Sh2 object is an overlap if ANY hits):
//   A. SIMBAD lists a plain NGC/IC/Messier identifier for it.
//   B. A shared cross-id (LBN/LDN/Ced/RCW/Gum/vdB) appears in a raw-OpenNGC
//      row's Identifiers — catches pairs SIMBAD models as separate objects
//      (the Wizard: Sh2-142 ↔ LBN 511 ↔ NGC 7380).
//   C. A raw-OpenNGC Identifiers entry names `SH 2-<n>` directly (the Cave).
//   D. Positional proximity to a raw-OpenNGC nebular row — a FLAG, not a
//      verdict: every flagged object must be hand-resolved as
//      overlap/distinct in curation/sharpless_curation.json, fail-loud both
//      ways (uncurated flag aborts; stale curation entry aborts). SIMBAD's NGC
//      linkage alone misses famous overlaps (M42, M16, the Crescent), which
//      is why layers B–D exist.

import { parseCsv, sexagesimalToDegrees } from './shared.mjs';
import { readRawText, readCuration } from './fetch.mjs';

/** The forms people type for a Sharpless number, mirroring the Caldwell
 *  treatment in parsers/deepsky.mjs (combobox matching is case-insensitive,
 *  so "Sh2-101" also covers the "SH2-101" primary-key form). */
export function sh2Variants(n) {
  return [`Sh2-${n}`, `SH 2-${n}`, `Sharpless ${n}`, `Sharpless${n}`];
}

const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };

// "LBN  548" / "lbn 0548" → "LBN 548": one whitespace-and-zero-insensitive key.
const normId = (s) => s.replace(/\s+/g, ' ').trim().toUpperCase().replace(/^([A-Z]+) 0+(\d)/, '$1 $2');

const sepArcmin = (ra1, de1, ra2, de2) => {
  const r = Math.PI / 180;
  const a = Math.sin(((de2 - de1) * r) / 2) ** 2
    + Math.cos(de1 * r) * Math.cos(de2 * r) * Math.sin(((ra2 - ra1) * r) / 2) ** 2;
  return ((2 * Math.asin(Math.sqrt(a))) / r) * 60;
};

// B1950 (FK4) → J2000 (FK5): standard rotation (Murray 1989 / SLALIB).
// E-terms of aberration (~0.3–1″) ignored — three orders of magnitude below
// these nebulae's arcmin-scale centroids; validated against SIMBAD J2000
// positions in parsers/sharpless.mjs (median offset ~1.2′ = centroid noise).
const FK4_TO_FK5 = [
  [0.9999256794956877, -0.0111814832204662, -0.0048590038153592],
  [0.0111814832391717, 0.9999374848933135, -0.0000271625947142],
  [0.0048590037723143, -0.0000271702937440, 0.9999881946023742],
];
function precessB1950toJ2000(raDeg, decDeg) {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  const v = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  const w = FK4_TO_FK5.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  return {
    ra: ((Math.atan2(w[1], w[0]) * 180) / Math.PI + 360) % 360,
    dec: (Math.asin(w[2] / Math.hypot(...w)) * 180) / Math.PI,
  };
}

/**
 * Load every raw and compute the full crosswalk. Returns:
 *   sharpless — all 313 VII/20 rows, J2000 `ra`/`dec` baked on (plus
 *               `ra1950`/`dec1950`, `diam` arcmin, `bright` class 1–3)
 *   kept      — the Sharpless-ONLY subset (parsers/sharpless.mjs mints these)
 *   overlaps  — [{n, via, match}] excluded pairs (parsers/deepsky.mjs merges these)
 *   simbadIds — Map n → [identifier strings] (designation assembly)
 *   simbadPos — Map n → {ra, dec} SIMBAD J2000 (precession cross-check)
 *   curation  — the parsed curation/sharpless_curation.json
 */
export function loadSharplessCrosswalk() {
  // ---- VII/20 fixed-width parse (byte columns per the VizieR ReadMe) ----
  const fw = (line, a, b) => line.slice(a - 1, b).trim();
  const sharpless = readRawText('sharpless')
    .split(/\r?\n/).filter((l) => l.trim().length > 0)
    .map((l) => {
      const sign = fw(l, 42, 42) === '-' ? -1 : 1;
      const row = {
        n: Number(fw(l, 1, 4)),
        // 1950.0 position (bytes 35–48); the 1900.0 one (21–34) is ignored.
        ra1950: (Number(fw(l, 35, 36)) + Number(fw(l, 37, 38)) / 60 + Number(fw(l, 39, 41)) / 10 / 3600) * 15,
        dec1950: sign * (Number(fw(l, 43, 44)) + Number(fw(l, 45, 46)) / 60 + Number(fw(l, 47, 48)) / 3600),
        diam: Number(fw(l, 49, 52)),   // max angular diameter, arcmin
        bright: Number(fw(l, 55, 55)), // 1 faintest … 3 brightest
      };
      return { ...row, ...precessB1950toJ2000(row.ra1950, row.dec1950) };
    });

  // ---- SIMBAD dumps: rows keyed by the padded "SH  2-101" form; sub-region
  // rows ("SH 2-127 A") are skipped. Quoted CSV; ra/dec plain numbers. ----
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

  // ---- raw OpenNGC: identifier index + nebular rows for the positional pass ----
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

  // ---- dedup ----
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
    // Layer D: positional flag → the curation file must decide.
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

  // A curation entry that no longer flags is stale — the raw data or the flag
  // rule changed underneath it; re-review rather than silently ignore.
  for (const key of Object.keys(curation.resolutions)) {
    if (!flaggedResolved.has(key)) {
      fail(`sharpless_curation.json entry for Sh2-${key} is stale: the object no longer positionally flags anything.`);
    }
  }

  return { sharpless, kept, overlaps, simbadIds, simbadPos, curation };
}
