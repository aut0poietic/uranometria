// Terminal output. No dependencies: colors come from node:util styleText,
// which strips ANSI on its own when the target stream isn't a TTY.
//
// Progress goes to stderr because it is ephemeral UI — `npm run parse > log`
// keeps the report and drops the bars. Reports go to stdout.

import { styleText } from 'node:util';

export const verbose = process.argv.includes('--verbose')
  || process.env.URANOMETRIA_VERBOSE === '1'
  || process.env.VERBOSE === '1';

const paint = (fmt, text, stream = process.stdout) => styleText(fmt, text, { stream });

export const dim = (t) => paint('dim', t);
export const bold = (t) => paint('bold', t);
export const red = (t) => paint('red', t);
export const green = (t) => paint('green', t);
export const yellow = (t) => paint('yellow', t);

// Column widths. Padding only — never truncate, a clipped filename is worse
// than a ragged column.
export const NAME_WIDTH = 15; // parser names
export const FILE_WIDTH = 28; // raw filenames, longest is stellarium_modern_index.json

const KB = 1024;
const MB = KB * 1024;
export function bytes(n) {
  if (n >= MB) return `${(n / MB).toFixed(1)} MB`;
  if (n >= KB) return `${(n / KB).toFixed(1)} KB`;
  return `${n} B`;
}

export const num = (n) => n.toLocaleString('en-US');

/**
 * A download meter. Renders a bar when the server gave a content-length and
 * stderr is a TTY; falls back to a byte counter when the length is unknown
 * (SIMBAD TAP is chunked) and to silence when piped — the caller's completion
 * line carries the result in that case.
 *
 * `total` is WIRE bytes. For the gzipped source that is the compressed size,
 * which is what a bandwidth meter should show.
 */
export function meter(label, total) {
  const out = process.stderr;
  const live = Boolean(out.isTTY);
  let read = 0;
  let last = 0;
  // A server that transparently decompresses can overrun content-length; drop
  // to a counter rather than render 130%.
  let known = Number.isFinite(total) && total > 0;

  const render = (force) => {
    if (!live) return;
    const now = Date.now();
    if (!force && now - last < 80) return;
    last = now;
    if (known && read > total) known = false;

    const name = label.padEnd(FILE_WIDTH);
    let line;
    if (known) {
      const frac = read / total;
      const width = Math.max(10, Math.min(28, (out.columns ?? 80) - FILE_WIDTH - 24));
      const full = Math.round(frac * width);
      const bar = '█'.repeat(full) + paint('dim', '░'.repeat(width - full), out);
      line = `  ${name} ${bar} ${String(Math.round(frac * 100)).padStart(3)}%  `
        + paint('dim', `${bytes(read)} / ${bytes(total)}`, out);
    } else {
      line = `  ${name} ${paint('dim', `${bytes(read)} downloaded`, out)}`;
    }
    out.write(`\r\x1b[2K${line}`);
  };

  return {
    tick(n) { read += n; render(false); },
    clear() { if (live) out.write('\r\x1b[2K'); },
    get read() { return read; },
  };
}

/**
 * One report per parser: a headline of facts plus the file it wrote. Aligned
 * across separate processes via NAME_WIDTH, since each parser is its own run.
 */
export function report(name, facts, checks, written) {
  const label = bold(name.padEnd(NAME_WIDTH));
  console.log(`  ${label} ${facts}  ${dim(`${checks} checks`)}`);
  if (written) {
    console.log(`  ${' '.repeat(NAME_WIDTH)} ${dim(`→ ${written.name} (${bytes(written.size)})`)}`);
  }
}

export function note(text) {
  if (verbose) console.log(`  ${' '.repeat(NAME_WIDTH)} ${dim(text)}`);
}
