
# Uranometria

Uranometria turns raw astronomical survey data into compact, render-ready JSON catalogs. Point a manifest at Hipparcos, OpenNGC, or any other survey, declare what you want kept, and get a normalized catalog your renderer can load without further processing.

Named for Bayer's 1603 star atlas, whose designations still show up in the labels this produces.

> **Licensing, in one line:** this code is MIT; the catalogs it produces are **not**.
> They inherit CC BY-SA 4.0 from their upstream sources, and the Sharpless output
> additionally forbids commercial use. Read [LICENSE.md](LICENSE.md) before publishing
> or shipping anything baked here.

## Usage

```sh
npm run parse
```

Fetches every raw source into `raw/`, then bakes `data/`. Both directories are
gitignored — no survey data is committed. `npm run fetch` on its own just
populates the cache; individual bakes run as `npm run parse:stars` and so on.

Order matters in two places: `parse:stars` reads `constellations.json` for its
union set, and `parse:catalog-stars` reads `stars.json`. Both fail loud if the
input is missing. Everything else is independent.

Zero runtime dependencies — plain Node ESM, `node:zlib` for the gzipped source,
`node:util` for terminal color, and a small quote-aware CSV splitter in
`lib/shared.mjs`. Node 22 or newer; `.nvmrc` pins the version we develop against.

### Output

Downloads show a progress bar; each bake reports one line of facts, the file it
wrote, and how many spot checks passed. Set `VERBOSE=1` to print every
individual check instead of the count:

```sh
VERBOSE=1 npm run parse
```

Progress bars go to stderr and disappear when output is piped, so
`npm run parse > build.log` keeps the report and drops the animation. Color
follows `NO_COLOR` and the terminal's own capabilities.

## Reproducibility

Every source is pinned by sha256 in `config.mjs`, verified both when fetched and
again when read at parse time. GitHub raw URLs are commit-pinned on top of that;
SIMBAD is a living database, so its ADQL queries carry an `ORDER BY` to make the
CSV byte-stable and the hash is its only pin.

A source that drifts aborts the fetch with the expected and actual hashes rather
than rebaking silently. Review what changed, then update the hash. For SIMBAD in
particular a changed dump can shift the Sharpless dedup and require re-curation.

Each parser also runs its own spot-check assertions inline and exits non-zero on
any failure — worked examples (Sirius, Vega, M31, the Crab, the Tulip), unit-
sphere and coordinate-range properties across every row, and set-equality
constraints between dependent bakes. Assertions over a whole collection use
`property()`, which checks every element and reports once, naming the offending
index and value on failure.

The `bytes` field on each source drives the download bar only, never
correctness. It is pinned because `content-length` can't be trusted here:
GitHub serves these gzip-encoded, so the header carries the compressed size
while `fetch` yields decompressed chunks, and the SIMBAD responses are chunked
with no length at all.

## Sources

| Source | Fetched as | Feeds |
|---|---|---|
| HYG v41 (astronexus/HYG-Database) | `hygdata_v41.csv` | `stars.json`, `catalog-stars.json` |
| Stellarium `modern` skyculture | `stellarium_modern_index.json` | `constellations.json` |
| OpenNGC (mattiaverga/OpenNGC) | `openngc_NGC.csv`, `openngc_addendum.csv` | `catalog-opengc.json`, `messier.json` |
| Sharpless 1959 (VizieR VII/20) | `sharpless_vii20.dat` | `catalog-sharpless.json` |
| Lynds 1965 (VizieR VII/9) | `lbn_vii9.dat` | `catalog-lbn.json` |
| SIMBAD TAP (identifiers, positions) | `simbad_sh2_idents.csv`, `simbad_sh2_pos.csv` | Sharpless crosswalk, LBN dedup |

Two curation files are hand-authored, not fetched, and committed:

- `curation/sharpless_curation.json` resolves the positional overlap flags the
  Sh2 ↔ OpenNGC crosswalk cannot decide on its own, and supplies common names
  and the occasional designation no source carries (Sh2-108 ← IC 1318).
- `curation/extras.json` holds targets **no** source carries, for objects whose
  catalog was never published as a machine-readable table. The Propeller
  (DWB 111 / Simeis 57) is the case that forced it: SIMBAD indexes the
  identifiers but VizieR publishes no DWB table, so there is nothing to pin a
  hash to. Every entry documents the provenance of each of its own values, and
  `parsers/extras.mjs` refuses to bake one that does not. Prefer adding a real
  source over adding a row here.

## Outputs (`data/`)

| File | Contents |
|---|---|
| `stars.json` | 8,922 stars: mag ≤ 6.5 ∪ every constellation-line HIP. `id` = HIP where present; optional `label` (proper names only, 355) and `ci` (B−V color index). |
| `constellations.json` | 88 constellations, polylines expanded to 695 `{star1, star2}` HIP segments. |
| `catalog-stars.json` | 355 proper-named stars as catalog rows — exactly the `stars.json` labeled set by construction, joined back to HYG only for designations. Spaceless `HIP91262` ids, HD fallback for 7 HIP-less binary companions. |
| `catalog-opengc.json` | 3,234 deep-sky objects to mag ≤ 13 plus mag-less nebular types, 2,015 flagged `capturable`. Carries `designations`, `difficulty`, per-scope `resolves_on`/`fits_fov`, and `redshift`. |
| `catalog-sharpless.json` | 261 Sharpless-only HII regions (`SH2-<n>` keys) — the Sh2 objects with no OpenNGC counterpart, so they merge into a combined catalog with zero collision risk. The 52 excluded overlaps ride along in `metadata.overlap_pairs`. |
| `catalog-lbn.json` | 515 LBN-only bright nebulae (`LBN<n>` keys) — the Lynds objects with no NGC/IC/Sh2/Ced counterpart, gated to ≥ 30′ of angular extent. Carries `lynds_brightness` (1–6, the 1965 plate index) as data, never as a filter. |
| `catalog-extras.json` | Hand-entered targets no catalog source carries. Currently 1 (the Propeller). The least authoritative output here — kept separate so consumers can weight it accordingly, and every value is documented in `metadata.provenance`. |
| `messier.json` | 110-object Messier backdrop (positions/types/mags from OpenNGC, incl. the M102 → NGC 5866 mapping). |

Coordinates are computed once here and baked: every object carries unit-sphere
`x,y,z` alongside RA/Dec, so consumers never recompute positions.

Each of these carries the license of the survey it came from, **not** this
repository's MIT — five are CC BY-SA 4.0, and `catalog-sharpless.json` and
`catalog-lbn.json` are under CDS terms that exclude commercial use.
`catalog-extras.json` is the one exception: it is derived from no source and is
MIT with the code. The per-file map, the CC BY-SA "changes made" record, and the
required CDS citations are in [LICENSE.md](LICENSE.md).

## Configuration

`config.mjs` holds every tunable: source URLs and hashes, output filenames, the
magnitude cutoffs (`bake.magCutoff` 6.5 for stars, `bake.magCeiling` 13.0 for
deep-sky), `bake.lbnMinDiamArcmin` (30′, the LBN admission gate — set it to 0 to
admit all 737 LBN-only rows), the smart-scope optics behind
`resolves_on`/`fits_fov`, the
`labelBayerFallback` flag that switches star labels between proper-names-only
and the full proper → Bayer → Flamsteed precedence, and the OpenNGC type map.

Output filenames are part of the contract with downstream consumers — renaming
one is a breaking change.
