// Raw-source acquisition. Downloads into raw/ (gitignored) and verifies every
// file against its config sha256, both on fetch and on read — so a parse can
// never run against a source that drifted out from under its pinned hash.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { paths, sources, curationFile } from '../config.mjs';
import { bytes, dim, FILE_WIDTH, green, meter, red } from './ui.mjs';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Drain a fetch body, metering bytes as they arrive. Prefers the pinned
 * `bytes` from config — content-length lies under gzip transport encoding and
 * is absent entirely on chunked TAP responses.
 */
async function drain(res, source) {
  const total = source.bytes ?? Number(res.headers.get('content-length'));
  const bar = meter(source.file, total);
  const chunks = [];
  for await (const chunk of res.body) {
    chunks.push(chunk);
    bar.tick(chunk.length);
  }
  bar.clear();
  return Buffer.concat(chunks.map(Buffer.from));
}

const line = (label, text) => console.log(`  ${label.padEnd(FILE_WIDTH)} ${text}`);

const rawPath = (source) => new URL(source.file, paths.raw);

function resolve(key) {
  const source = sources[key];
  if (!source) throw new Error(`Unknown source "${key}" — see config.mjs`);
  return source;
}

async function download(source) {
  if (source.tap) {
    const body = new URLSearchParams({
      REQUEST: 'doQuery',
      LANG: 'ADQL',
      FORMAT: 'csv',
      QUERY: source.tap.query,
    });
    const res = await fetch(source.tap.url, { method: 'POST', body });
    if (!res.ok) throw new Error(`TAP query failed: ${res.status} ${res.statusText}`);
    const buf = await drain(res, source);
    // TAP reports ADQL errors as a 200 with a VOTABLE body instead of CSV.
    if (buf[0] === 0x3c) throw new Error(`TAP query rejected:\n${buf.subarray(0, 800)}`);
    return { buf, wire: buf.length };
  }
  const res = await fetch(source.url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${source.url}`);
  const buf = await drain(res, source);
  return source.gunzip ? { buf: gunzipSync(buf), wire: buf.length } : { buf, wire: buf.length };
}

/** Download one source unless a checksum-clean copy is already cached. */
export async function fetchSource(key) {
  const source = resolve(key);
  const path = rawPath(source);
  if (existsSync(path)) {
    if (sha256(readFileSync(path)) === source.sha256) {
      line(source.file, dim('cached'));
      return;
    }
    line(source.file, `${red('⚠')} cached copy failed its checksum — refetching`);
  }
  const { buf, wire } = await download(source);
  const got = sha256(buf);
  if (got !== source.sha256) {
    console.error(`\n${red('✗ CHECKSUM MISMATCH')}  ${source.file} — the source changed upstream.`);
    console.error(`   expected ${source.sha256}`);
    console.error(`   got      ${got}`);
    console.error('\n   Review the diff, then update the hash in config.mjs. Do not bake blind.\n');
    process.exit(1);
  }
  mkdirSync(paths.raw, { recursive: true });
  writeFileSync(path, buf);
  // The gunzipped source metered its compressed payload — say so, or the bar's
  // total and this line look like they disagree.
  const size = source.gunzip
    ? `${bytes(buf.length)} (${bytes(wire)} gzipped)`
    : bytes(buf.length);
  line(source.file, `${green('✓')} ${dim(size)}`);
}

export async function fetchAll() {
  // Sequential on purpose: one bar at a time, and it keeps us polite to the
  // upstream CDNs.
  for (const key of Object.keys(sources)) await fetchSource(key);
}

/** Read a cached raw source, re-verifying its checksum. Fails loud if absent. */
export function readRaw(key) {
  const source = resolve(key);
  const path = rawPath(source);
  if (!existsSync(path)) {
    console.error(`✗ raw/${source.file} is missing — run \`npm run fetch\` first.`);
    process.exit(1);
  }
  const buf = readFileSync(path);
  if (sha256(buf) !== source.sha256) {
    console.error(`✗ raw/${source.file} does not match its pinned checksum — re-run \`npm run fetch\`.`);
    process.exit(1);
  }
  return buf;
}

export const readRawText = (key) => readRaw(key).toString('utf8');

export const readCuration = () =>
  JSON.parse(readFileSync(new URL(curationFile, paths.curation), 'utf8'));
