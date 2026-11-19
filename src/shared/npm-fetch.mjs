import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

const [, , pkgSpec, outDir] = process.argv;
const last = pkgSpec.lastIndexOf('@');
const pkg = last > 0 ? pkgSpec.slice(0, last) : pkgSpec;
const ver = last > 0 ? pkgSpec.slice(last + 1) : 'latest';

async function get(url, redirects = 0) {
  if (redirects > 5) throw new Error('Too many redirects');
  const response = await fetch(url, { redirect: 'manual' });
  if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
    await response.body?.cancel();
    return get(new URL(response.headers.get('location'), url).href, redirects + 1);
  }
  if (response.status !== 200) throw new Error(`HTTP ${response.status} for ${url}`);
  return response;
}

const meta = await (await get(`https://registry.npmjs.org/${pkg}/${ver}`)).json();
console.log(`Resolved ${pkg}@${meta.version}`);
const tgz = await (await get(meta.dist.tarball)).arrayBuffer();
console.log(`Downloaded ${(tgz.byteLength / 1024 / 1024).toFixed(1)} MB`);

const buf = gunzipSync(tgz);
// Only these regular files are consumed by the installers. Archive paths never select a destination.
const binary = pkg.includes('-win32-') ? 'claude.exe' : 'claude';
const wanted = new Set(['package.json', binary]);
const files = new Map();
let off = 0;
while (off + 512 <= buf.length) {
  const name = buf.slice(off, off + 100).toString('utf8').replace(/\0+$/, '');
  if (!name) break;
  const sizeOct = buf.slice(off + 124, off + 136).toString('utf8').replace(/[\0\s]+$/, '');
  if (!/^[0-7]+$/.test(sizeOct)) throw new Error(`Invalid tar entry size: ${name}`);
  const size = parseInt(sizeOct, 8);
  const typeflag = String.fromCharCode(buf[off + 156]);
  off += 512;
  if (off + Math.ceil(size / 512) * 512 > buf.length) throw new Error(`Truncated tar entry: ${name}`);
  const leaf = name.slice('package/'.length);
  if (name.startsWith('package/') && wanted.has(leaf) && (typeflag === '0' || typeflag === '\0')) {
    if (files.has(leaf)) throw new Error(`Duplicate tar entry: ${name}`);
    files.set(leaf, buf.subarray(off, off + size));
  }
  off += Math.ceil(size / 512) * 512;
}
if (files.size !== wanted.size) throw new Error(`Tarball must contain package.json and ${binary}`);
const directory = join(outDir, 'package');
mkdirSync(outDir, { recursive: true });
mkdirSync(directory);
for (const [leaf, data] of files) writeFileSync(join(directory, leaf), data, { flag: 'wx' });
console.log(`Extracted ${files.size} files`);
console.log(`VERSION=${meta.version}`);
