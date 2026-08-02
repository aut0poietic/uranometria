// Greek-letter Bayer formatting, shared by parse_hipparcos.mjs (the label
// fallback machinery preserved behind LABEL_BAYER_FALLBACK) and
// parse_catalog_stars.mjs (the `designations` bake). One formatter so a
// label and a designation for the same star can never render differently.

export const GREEK = {
  Alp: 'α', Bet: 'β', Gam: 'γ', Del: 'δ', Eps: 'ε', Zet: 'ζ', Eta: 'η',
  The: 'θ', Iot: 'ι', Kap: 'κ', Lam: 'λ', Mu: 'μ', Nu: 'ν', Xi: 'ξ',
  Omi: 'ο', Pi: 'π', Rho: 'ρ', Sig: 'σ', Tau: 'τ', Ups: 'υ', Phi: 'φ',
  Chi: 'χ', Psi: 'ψ', Ome: 'ω',
};

export const SUPERSCRIPT = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

/**
 * HYG bayer token + constellation abbr → "α² Cap"-style string.
 * Accepts "Alp", "Alp-2", and defensively "Alp2". Returns null when the
 * token doesn't map — the caller decides how to report (parse_hipparcos
 * warns and falls through to Flamsteed).
 */
export function formatBayer(bayerToken, con) {
  const m = bayerToken.match(/^([A-Za-z]+)-?(\d+)?$/);
  const greek = m ? GREEK[m[1]] : undefined;
  if (!greek) return null;
  const sup = m[2] ? [...m[2]].map((d) => SUPERSCRIPT[d] ?? d).join('') : '';
  return `${greek}${sup} ${con}`;
}
