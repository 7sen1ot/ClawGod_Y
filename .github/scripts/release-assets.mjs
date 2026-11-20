import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const assets = ['clawgod-runtime.tar.gz', 'SHA256SUMS'];

export function prepareInstallers(root, tag) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag) || tag !== tag.trim()) throw new Error(`Invalid release tag: ${tag}`);
  const files = [['install.sh', /^CLAWGOD_RELEASE="[^"\r\n]*"$/gm, `CLAWGOD_RELEASE="${tag}"`],
    ['install.ps1', /^\$ClawRelease = '[^'\r\n]*'$/gm, `$ClawRelease = '${tag}'`]];
  const rendered = files.map(([name, pattern, replacement]) => {
    const source = readFileSync(join(root, name), 'utf8');
    if ([...source.matchAll(pattern)].length !== 1) throw new Error(`${name}: expected exactly one release assignment`);
    if (source.includes('{{CLAWGOD:')) throw new Error(`${name}: obsolete build placeholder`);
    if (name === 'install.ps1' && (!source.startsWith('#Requires') || /[^\x00-\x7f]/.test(source))) throw new Error('install.ps1 must be BOM-free ASCII');
    return [name, source.replace(pattern, replacement)];
  });
  for (const [name, source] of rendered) writeFileSync(join(root, name), source);
}

export function verifyAssets(root) {
  for (const name of ['install.sh', 'install.ps1', 'uninstall.sh', 'uninstall.ps1', ...assets.map(name => join('dist', name))]) {
    const info = statSync(join(root, name));
    if (!info.isFile() || info.size === 0) throw new Error(`Release asset is empty or not a file: ${name}`);
  }
}

if (import.meta.main) {
  prepareInstallers(process.cwd(), process.argv[2]);
  verifyAssets(process.cwd());
}
