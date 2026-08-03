export const paths = {
  raw: new URL('./raw/', import.meta.url),
  data: new URL('./data/', import.meta.url),
  curation: new URL('./curation/', import.meta.url),
};

// SIMBAD is live; its ORDER BY is what makes the CSV byte-stable between fetches.
// `bytes` meters the download only — the stream's own byte count, not content-length.
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
  // M40 and M45 have no NGC/IC number and live only here.
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
  // Its `Name` column cross-references NGC/IC/Sharpless/Cederblad — that is the dedup layer.
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

// Committed, not fetched.
export const curationFile = 'sharpless_curation.json';
export const extrasFile = 'extras.json';

// Renaming one is a breaking change for downstream consumers.
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
  // Infinity = full catalog.
  magCeiling: 13.0,
  // LBN-only gate, arcmin. Gates on extent, not Lynds' brightness class — that
  // 1965 plate index anticorrelates with what a modern sensor stacks. 0 admits all 737.
  lbnMinDiamArcmin: 30,
  // true restores the proper > Bayer > Flamsteed bake.
  labelBayerFallback: false,
  schemaVersion: 1,
};

// pixel scale = 206.265 * pixel_um / focal_mm
export const scopes = {
  s30pro: { pxScale: (206.265 * 2.9) / 160, fovShortArcmin: 136, label: '30mm f/5.3 160mm' },
  s50: { pxScale: (206.265 * 2.9) / 250, fovShortArcmin: 42, label: '50mm f/5 250mm' },
};

// Pixels an object must span to read as a shape, not a dot.
export const RESOLVE_PX = 30;

export const TYPE_MAP = {
  'G': 'galaxy', 'GPair': 'galaxy_pair', 'GTrpl': 'galaxy_triplet', 'GGroup': 'galaxy_group',
  'PN': 'planetary_nebula', 'OCl': 'open_cluster', 'GCl': 'globular_cluster',
  'Cl+N': 'cluster_with_nebula', 'Neb': 'nebula', 'EmN': 'emission_nebula',
  'RfN': 'reflection_nebula', 'DrkN': 'dark_nebula', 'HII': 'hii_region',
  'SNR': 'supernova_remnant', 'Nova': 'nova', '*': 'star', '**': 'double_star',
  '*Ass': 'stellar_association', 'NonEx': 'nonexistent', 'Dup': 'duplicate', 'Other': 'other',
};
