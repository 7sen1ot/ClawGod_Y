import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { URL } from 'node:url';

const [, , pkgSpec, outDir] = process.argv;
const last = pkgSpec.lastIndexOf('@');
const pkg = last > 0 ? pkgSpec.slice(0, last) : pkgSpec;
const ver = last > 0 ? pkgSpec.slice(last + 1) : 'latest';

async function get(url, redirects = 0) {
  if (redirects > 5) throw new Error('Too many redirects');
  const response = await fetch(url, { redirect: 'manual' });
  if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
    return get(new URL(response.headers.get('location'), url).href, redirects + 1);
  }
  if (response.status !== 200) throw new Error(`HTTP ${response.status} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

const metaBuf = await get(`https://registry.npmjs.org/${pkg}/${ver}`);
const meta = JSON.parse(metaBuf.toString('utf8'));
console.log(`Resolved ${pkg}@${meta.version}`);
const tgz = await get(meta.dist.tarball);
console.log(`Downloaded ${(tgz.length / 1024 / 1024).toFixed(1)} MB`);

const buf = gunzipSync(tgz);
mkdirSync(outDir, { recursive: true });
let off = 0, files = 0;
while (off + 512 <= buf.length) {
  const name = buf.slice(off, off + 100).toString('utf8').replace(/\0+$/, '');
  if (!name) break;
  const sizeOct = buf.slice(off + 124, off + 136).toString('utf8').replace(/[\0\s]+$/, '');
  if (!/^[0-7]+$/.test(sizeOct)) throw new Error(`Invalid tar entry size: ${name}`);
  const size = parseInt(sizeOct, 8);
  const typeflag = String.fromCharCode(buf[off + 156]);
  off += 512;
  if (off + Math.ceil(size / 512) * 512 > buf.length) throw new Error(`Truncated tar entry: ${name}`);
  if (typeflag === '0' || typeflag === '\0') {
    const dest = join(outDir, name);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, buf.slice(off, off + size));
    files++;
  }
  off += Math.ceil(size / 512) * 512;
}
if (files === 0) throw new Error('Tarball contains no files');
console.log(`Extracted ${files} files`);
console.log(`VERSION=${meta.version}`);
