// Every tunable in one place: where raws come from, where bakes go, and the
// knobs that decide what lands in them.
//
// Raw survey data is NEVER committed — `npm run fetch` downloads each source
// into raw/ and verifies its sha256. A drifted source aborts the fetch instead
// of silently rebaking; update the hash only after reviewing what changed.

export const paths = {
  raw: new URL('./raw/', import.meta.url),
  data: new URL('./data/', import.meta.url),
  curation: new URL('./curation/', import.meta.url),
};

// GitHub raw URLs are commit-pinned. VII/20 is a frozen 1995 digitization.
// SIMBAD is a living database — the sha256 is the only pin it has, and the
// ORDER BY is what makes its CSV byte-stable between fetches.
//
// `bytes` drives the download meter only — never correctness, which is the
// sha256's job. It is the count the response stream actually yields, which is
// NOT content-length: GitHub serves these gzip-encoded, so content-length is
// the compressed size while fetch hands back decompressed chunks, and SIMBAD
// TAP is chunked with no length at all. For the one source we gunzip ourselves
// this is the compressed payload, since that is what crosses the wire.
export const sources = {
  hyg: {
    file: 'hygdata_v41.csv',
    url: 'https://raw.githubusercontent.com/astronexus/HYG-Database/3bf37f4b2d5460e1278286320d1d62fab9b493c1/hyg/CURRENT/hygdata_v41.csv',
    bytes: 33932548,
    sha256: 'd9f69fd86bbf90a4e4d52b4c5c53eacfa6dfc0bfdef85bfd94f095e0bebe4ebd',
    provenance: 'HYG v41 (astronexus/HYG-Database @ 3bf37f4b2d5460e1278286320d1d62fab9b493c1)',
  },
  stellarium: {
    file: 'stellarium_modern_index.json',
    url: 'https://raw.githubusercontent.com/Stellarium/stellarium/daace2add6a1bf886e8ee1934f51e9c69f818d18/skycultures/modern/index.json',
    bytes: 205767,
    sha256: '1f2f5ffd6c9e25a7d0dcfdbf1f756e2db03dd3b8ed4ec016a2839b09f6b0fe1e',
    provenance: 'Stellarium skycultures/modern/index.json @ daace2add6a1bf886e8ee1934f51e9c69f818d18',
  },
  openngc: {
    file: 'openngc_NGC.csv',
    url: 'https://raw.githubusercontent.com/mattiaverga/OpenNGC/36cb178a0f69dba8bfc03a99c10512831edf1c6b/database_files/NGC.csv',
    bytes: 3876288,
    sha256: '840fe0c9ee1332e551b2e722a0e92726cd7b157914a3d2177602832aadd3aa9e',
    provenance: 'OpenNGC (mattiaverga/OpenNGC @ 36cb178a0f69dba8bfc03a99c10512831edf1c6b)',
  },
  // M40 and M45 have no NGC/IC number and live only here — hence two files.
  openngcAddendum: {
    file: 'openngc_addendum.csv',
    url: 'https://raw.githubusercontent.com/mattiaverga/OpenNGC/36cb178a0f69dba8bfc03a99c10512831edf1c6b/database_files/addendum.csv',
    bytes: 17484,
    sha256: '1d8f0914e643ada325a5a94d88d8fefad6a4937a2f77cc34f21483af22b11983',
  },
  sharpless: {
    file: 'sharpless_vii20.dat',
    url: 'https://cdsarc.cds.unistra.fr/ftp/VII/20/catalog.dat.gz',
    gunzip: true,
    bytes: 8137,
    sha256: 'f52497aa500ae6dd33de994ab889a38879b900e1fe798e4306bbfdb246a645b0',
    provenance: 'Sharpless 1959 (VizieR VII/20) + SIMBAD TAP identifier/position dumps',
  },
  // VII/9 is a frozen 1965 digitization, served uncompressed. Its `Name` column
  // cross-references NGC/IC/Sharpless/Cederblad/DG, which IS the dedup layer —
  // no separate identifier dump needed the way Sharpless needs SIMBAD.
  lbn: {
    file: 'lbn_vii9.dat',
    url: 'https://cdsarc.cds.unistra.fr/ftp/VII/9/catalog.dat',
    bytes: 70072,
    sha256: 'ba501b6d0479bfecf3de55e66bc7aec61aabacce48fafecf480bf0fa31a16c1b',
    provenance: 'Lynds 1965 Catalogue of Bright Nebulae (VizieR VII/9)',
  },
  simbadIdents: {
    file: 'simbad_sh2_idents.csv',
    tap: {
      url: 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync',
      query: "SELECT i1.id AS sh, i2.id AS other FROM ident AS i1"
        + " JOIN ident AS i2 ON i1.oidref = i2.oidref"
        + " WHERE i1.id LIKE 'SH  2-%' ORDER BY sh, other",
    },
    bytes: 72661,
    sha256: '79c7ff6fc9d55ea13721c558c3aef42b9cc57d1d16c4b2c5e5fe6108aec82564',
  },
  simbadPos: {
    file: 'simbad_sh2_pos.csv',
    tap: {
      url: 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync',
      query: "SELECT i1.id AS sh, basic.ra AS ra, basic.dec AS dec FROM ident AS i1"
        + " JOIN basic ON basic.oid = i1.oidref"
        + " WHERE i1.id LIKE 'SH  2-%' ORDER BY sh",
    },
    bytes: 15511,
    sha256: 'f1a7b3211977621ca41bcf2e6cf8da0886c3e11e87e9774d5b60acf6159d3dcc',
  },
};

// Hand-curated, not fetched: overlap/distinct resolutions for Sharpless
// positional flags, plus common names. Committed.
export const curationFile = 'sharpless_curation.json';

// Hand-entered targets with no machine-readable catalog behind them. Committed.
export const extrasFile = 'extras.json';

// Downstream consumers copy these by name — renaming one is a breaking change.
export const outputs = {
  constellations: 'constellations.json',
  stars: 'stars.json',
  catalogStars: 'catalog-stars.json',
  messier: 'messier.json',
  deepsky: 'catalog-opengc.json',
  sharpless: 'catalog-sharpless.json',
  lbn: 'catalog-lbn.json',
  extras: 'catalog-extras.json',
};

export const bake = {
  // A star is kept if mag <= magCutoff OR its HIP appears in a constellation line.
  magCutoff: 6.5,
  // Outer deep-sky boundary. 13.0 = subjects + useful context; Infinity = full catalog.
  magCeiling: 13.0,
  // LBN-only admission gate, arcmin. Lynds' 1-6 brightness index is a 1965
  // Palomar-plate judgement and anticorrelates with what a modern sensor can
  // stack (LBN 555 is class 6, "barely detectable", and a routine target), so
  // extent — not brightness — decides. 30′ keeps anything that reads as a shape
  // and drops the plate specks. 0 admits all 737 LBN-only rows.
  lbnMinDiamArcmin: 30,
  // false = proper names only. true restores the proper > Bayer > Flamsteed bake.
  labelBayerFallback: false,
  schemaVersion: 1,
};

// Smart-scope optics (pixel scale = 206.265 * pixel_um / focal_mm). Read by
// both the deep-sky and Sharpless bakes for resolves_on / fits_fov.
export const scopes = {
  s30pro: { pxScale: (206.265 * 2.9) / 160, fovShortArcmin: 136, label: '30mm f/5.3 160mm' },
  s50: { pxScale: (206.265 * 2.9) / 250, fovShortArcmin: 42, label: '50mm f/5 250mm' },
};

// An object must span this many pixels on a scope to read as a shape, not a dot.
export const RESOLVE_PX = 30;

// OpenNGC type codes -> flat types. Read by the deep-sky and Messier bakes.
export const TYPE_MAP = {
  'G': 'galaxy', 'GPair': 'galaxy_pair', 'GTrpl': 'galaxy_triplet', 'GGroup': 'galaxy_group',
  'PN': 'planetary_nebula', 'OCl': 'open_cluster', 'GCl': 'globular_cluster',
  'Cl+N': 'cluster_with_nebula', 'Neb': 'nebula', 'EmN': 'emission_nebula',
  'RfN': 'reflection_nebula', 'DrkN': 'dark_nebula', 'HII': 'hii_region',
  'SNR': 'supernova_remnant', 'Nova': 'nova', '*': 'star', '**': 'double_star',
  '*Ass': 'stellar_association', 'NonEx': 'nonexistent', 'Dup': 'duplicate', 'Other': 'other',
};
