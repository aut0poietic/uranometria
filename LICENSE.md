# Licensing — Uranometria

**Read this before publishing anything this software produces.**

Two kinds of material are involved, under different terms, and conflating them is the
mistake this file exists to prevent:

| | Material | Terms |
|---|---|---|
| §1 | This repository's source code | **MIT** — see §1 |
| §2 | The JSON catalogs it *produces* | **Not MIT.** Per-source, see §2 |

The code is permissively licensed and free for commercial use. **The catalogs it bakes are
not the code's to license.** They are adapted material derived from third-party astronomical
catalogs, and they carry those catalogs' obligations — including, for one source, a
prohibition on commercial use. Running this software does not launder those terms.

This repository ships **no catalog data at all**: `raw/` and `data/` are both gitignored, so
cloning it redistributes nothing but code. The obligations in §2 attach when *you* run the
parsers and then share, serve, or ship the output.

---

## 1. Source code — MIT

Everything tracked in this repository — `config.mjs`, `bin/`, `lib/`, `parsers/`,
`curation/sharpless_curation.json`, and `curation/extras.json` — is original first-party work.

```
MIT License

Copyright (c) 2026 Jeremy Brand

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE OTHER DEALINGS IN THE
SOFTWARE.
```

The code is not a derivative work of the catalogs in §5: it reads raw files at run time and
contains no substantial catalog content. The share-alike obligations in §2 attach to the
output files, not to the parsers.

The parsers do embed a small number of catalog-derived constants — worked-example assertions
(Sirius's coordinates, Vega's designations, the Crab's position), the seven expected HD
fallback ids, and the hand-curated names in `curation/sharpless_curation.json`. These are
individual astronomical facts used as test fixtures, not a substantial extraction of any
source, and they remain MIT.

## 2. Derived catalogs — NOT MIT

The files written into `data/` are **adapted material** produced from the sources in §5.

| Output | Derived from | License |
|---|---|---|
| `stars.json` | HYG v41 | CC BY-SA 4.0 |
| `catalog-stars.json` | HYG v41 | CC BY-SA 4.0 |
| `constellations.json` | Stellarium `modern` skyculture | CC BY-SA 4.0 |
| `messier.json` | OpenNGC | CC BY-SA 4.0 |
| `catalog-opengc.json` | OpenNGC, plus Sh2 cross-identifiers (see note) | CC BY-SA 4.0 |
| `catalog-sharpless.json` | Sharpless VII/20 + SIMBAD | **CDS terms — non-commercial**, see §5.4 |
| `catalog-lbn.json` | Lynds VII/9 | **CDS terms — non-commercial**, see §5.5 |
| `catalog-extras.json` | Nothing — hand-entered | **MIT**, see §2 note |

**Note on `catalog-opengc.json`.** This file is OpenNGC-derived (CC BY-SA 4.0) with Sh2
cross-identifiers and curated common names merged onto ~50 rows via
`lib/sharpless_crosswalk.mjs`. What is merged is limited to factual designations and object
names — "Sh2-155", "Cave Nebula" — not expressive content, so the file remains CC BY-SA 4.0,
with CDS acknowledged as the source of those identifiers. The substantial Sharpless
extraction lives in `catalog-sharpless.json`.

**Note on `catalog-extras.json`.** This file is derived from no source at all. It is a
handful of hand-entered targets — positions read off SIMBAD's public object pages, names in
common amateur usage — for objects whose catalogs were never published as machine-readable
tables. Individual astronomical facts are not copyrightable and a handful of them is not a
substantial extraction of any database, so this file is first-party work under §1's MIT
grant. It is the one output with no share-alike or non-commercial obligation attached. Keep
it that way: if it ever grows large enough to constitute a substantial extraction from
another catalog, add that catalog as a real pinned source in `config.mjs` instead, and give
it its own row above.

**Keep `catalog-sharpless.json` and `catalog-lbn.json` separate files.** Their terms differ
from the BY-SA catalogs. Merging either into `catalog-opengc.json` — or bundling them inside
anything advertised as "CC BY-SA data" — would mislicense someone else's material. The
parsers keep these outputs separate deliberately; do not recombine them downstream.

### If you share the CC BY-SA outputs

BY-SA 4.0 requires four things: credit the source, link the license, indicate that changes
were made, and license your adaptation under BY-SA 4.0 or a compatible license. §4 below is
the "changes made" record and may be reproduced to satisfy that clause. You may **not**
relicense these files under MIT because the parsers are MIT.

BY-SA §3 also forbids applying technological measures that restrict what the license
permits — so if you publish them, publish them as plain files, without gating.

Note that BY-SA has no "provide the source" clause; that is a GPL concept with no CC
equivalent. Nothing obliges you to publish the JSON at all.

## 3. Commercial use — the one real trap

The MIT grant in §1 lets you use this software commercially. That permission **does not
extend to `catalog-sharpless.json` or `catalog-lbn.json`**, or to any product built from them.

CDS makes the Sharpless, Lynds, and SIMBAD material freely available for scientific and
educational use but **not for commercial purposes**. If your use is commercial, do not run
`parsers/sharpless.mjs` or `parsers/lbn.mjs`, do not ship their output, and strip the Sh2
fields merged into `catalog-opengc.json`. Everything else — HYG, Stellarium, OpenNGC, and the
hand-entered `catalog-extras.json` — permits commercial use, so the remaining six outputs are
unaffected.

## 4. Changes made (required by CC BY-SA 4.0)

The output is not a copy of any source. Across all catalogs, RA/Dec are converted once into
unit-sphere Cartesian coordinates and baked; consumers never recompute positions. Numeric
values are rounded. Per-source:

- **HYG v41 →** Filtered to magnitude ≤ 6.5 united with every HIP id referenced by a
  constellation line (8,922 of 119,626 rows). RA converted from hours to degrees. HYG's own
  distance-scaled `x,y,z` discarded in favour of unit-sphere coordinates. Row id 0 (Sol)
  excluded. Duplicate HIP rows dropped, first row winning. Labels restricted to proper names,
  with catalog designations dropped. B−V colour index retained. `catalog-stars.json` further
  joins the labelled subset back to HYG for designation columns only, minting spaceless
  `HIP`/`HD` ids and assembling Bayer and padded/bare designation forms.
- **Stellarium `modern` →** Only `lines` and `common_names` used. Polylines expanded into
  695 pairwise `{star1, star2}` segments. Display names taken from `common_name.native`,
  abbreviations from the trailing token of `id`. Constellation boundaries, zodiac data,
  asterisms, and all artwork discarded. **No Stellarium artwork is used or redistributed.**
- **OpenNGC →** Sexagesimal RA/Dec strings converted to decimal degrees. Messier numbers
  un-zero-padded; M102 explicitly mapped to NGC 5866. Type codes normalised to an internal
  vocabulary. Filtered to magnitude ≤ 13 plus mag-less nebular types, and to imaging-relevant
  types. Rows sorted by RA and de-duplicated by name. Derived fields added that are not in
  the source: `difficulty`, `capturable`, `resolves_on`, `fits_fov`, and a `designations`
  alias list assembled from the `Identifiers` column under an allow-list.
- **Sharpless VII/20 →** Fixed-width records parsed per the VizieR ReadMe. Coordinates
  precessed from B1950 to J2000 (FK4→FK5 rotation; E-terms of aberration, ~0.3″, ignored).
  Magnitudes null by rule; brightness class mapped to a derived `difficulty`; `capturable`
  true by rule. Objects with an OpenNGC counterpart excluded and recorded as overlap pairs.
  Cross-identifiers sourced from SIMBAD rather than the catalog.
- **Lynds VII/9 →** Fixed-width records parsed per the VizieR ReadMe. Coordinates precessed
  from B1950 to J2000 (same FK4→FK5 rotation as VII/20). Filtered to objects with no NGC/IC/
  Sharpless/Cederblad counterpart — by the catalog's own cross-reference column, or by an LBN
  number already carried as an alias elsewhere in the bake — and then to a minimum angular
  extent, discarding 610 of 1,125 rows. Magnitudes null by rule; the 1–6 brightness index
  retained as `lynds_brightness` and mapped to a derived `difficulty`; `capturable` true by
  rule. Derived fields added that are not in the source: `difficulty`, `capturable`,
  `resolves_on`, `fits_fov`, `designations`. The colour index and complexity id are discarded.
- **SIMBAD →** TAP/ADQL query results for `SH 2-*` identifiers and J2000 positions, used for
  cross-identification and de-duplication against OpenNGC, and for designation assembly.

## 5. Sources

### 5.1 HYG Database v41 — star positions, magnitudes, names

- **Source:** <https://github.com/astronexus/HYG-Database> (David Nash / astronexus)
- **Pinned:** commit `3bf37f4b2d5460e1278286320d1d62fab9b493c1`, `hyg/CURRENT/hygdata_v41.csv`
- **License:** [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- **Compiled from** the Hipparcos, Yale Bright Star, and Gliese catalogs.

### 5.2 Stellarium `modern` skyculture — constellation lines and names

- **Source:** <https://github.com/Stellarium/stellarium>, `skycultures/modern/`
- **Pinned:** commit `daace2add6a1bf886e8ee1934f51e9c69f818d18`
- **License:** [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) — the
  skyculture states "Text and data: CC BY-SA 4.0; Illustrations: Free Art License".
  Data only is used.
- **Credit:** Stellarium's team.
- The GPL-2.0-or-later covering the Stellarium *application* does not apply to this
  skyculture data and does not reach this project.

### 5.3 OpenNGC — deep-sky object positions, types, magnitudes

- **Source:** <https://github.com/mattiaverga/OpenNGC> (Mattia Verga)
- **Pinned:** commit `36cb178a0f69dba8bfc03a99c10512831edf1c6b` (release v20260501)
- **License:** [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) per the
  repository's REUSE metadata (`.reuse/dep5`: `Files: *`), © 2023 Mattia Verga.

### 5.4 Sharpless catalog (VizieR VII/20) and SIMBAD — HII regions

Both are services of the Centre de Données astronomiques de Strasbourg (CDS). They are
**not** Creative Commons licensed. CDS makes them freely available for scientific and
educational use, but **not for commercial purposes**, and requires that original authors and
publications be explicitly cited.

- **Sharpless catalog:** Sharpless, S. 1959, *"A Catalogue of H II Regions"*, Astrophysical
  Journal Supplement Series, **4**, 257. Obtained as VizieR catalogue
  [VII/20](https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=VII/20).
- **SIMBAD:** Wenger, M. et al. 2000, A&AS, **143**, 9, *"The SIMBAD astronomical database"*.
  <https://simbad.cds.unistra.fr/>
- **VizieR:** Ochsenbein, F., Bauer, P., Marcout, J. 2000, A&AS, **143**, 23, *"The VizieR
  database of astronomical catalogues"*. DOI:
  [10.26093/cds/vizier](https://doi.org/10.26093/cds/vizier)

**Required acknowledgements**, reproduced verbatim as CDS specifies. If you publish anything
derived from these sources, these two sentences must appear:

> This research has made use of the SIMBAD database, CDS, Strasbourg Astronomical
> Observatory, France.

> This research has made use of the VizieR catalogue access tool, CDS, Strasbourg
> Astronomical Observatory, France.

### 5.5 Lynds Catalogue of Bright Nebulae (VizieR VII/9) — LBN nebulae

A CDS service on the same terms as §5.4: freely available for scientific and educational use,
**not for commercial purposes**, with the original publication explicitly cited.

- **Catalog:** Lynds, B. T. 1965, *"Catalogue of Bright Nebulae"*, Astrophysical Journal
  Supplement Series, **12**, 163. Obtained as VizieR catalogue
  [VII/9](https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=VII/9).
- The VizieR acknowledgement in §5.4 covers this source too and must accompany anything
  derived from it.

## 6. Changing or adding a source

The per-source terms above are tied to the pinned commits in `config.mjs`. If you repoint a
source, add one, or update a pin, re-check its license before baking — §2 and §5 must stay in
step with what `config.mjs` actually fetches. A new source with incompatible terms may
require a new output file rather than a new field on an existing one, for the same reason
`catalog-sharpless.json` is kept separate.
