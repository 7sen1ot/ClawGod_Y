#!/usr/bin/env bun
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { featuresMeta } from './src/shared/patch-registry.mjs';
import { payloads } from './src/shared/runtime-files.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const check = args[0] === '--check';
const tag = args[0] === '--release' ? args[1] : undefined;
if (args.length && !(check && args.length === 1) && !(tag && args.length === 2)) throw new Error('Usage: bun build.js [--check|--release vX.Y.Z]');
if (tag && !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) throw new Error('Invalid release tag');
const project = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const pinnedBun = readFileSync(join(root, '.bun-version'), 'utf8').trim();
if (project.packageManager !== `bun@${pinnedBun}`) throw new Error('packageManager must match the development Bun version in .bun-version');
if (!/^>=\d+\.\d+\.\d+$/.test(project.engines?.bun)) throw new Error('engines.bun must declare the minimum supported Bun version as >=X.Y.Z');

for (const name of ['install.sh', 'install.ps1', 'uninstall.sh', 'uninstall.ps1']) {
  let content = readFileSync(join(root, 'src', 'templates', name), 'utf8');
  if (tag) content = content.replace('CLAWGOD_RELEASE="latest"', `CLAWGOD_RELEASE="${tag}"`)
    .replace("$ClawRelease = 'latest'", `$ClawRelease = '${tag}'`);
  if (check) {
    if (existsSync(join(root, name)) && readFileSync(join(root, name), 'utf8') !== content) throw new Error(`Out of date: ${name}`);
  } else {
    writeFileSync(join(root, name), content);
    if (name.endsWith('.sh')) chmodSync(join(root, name), 0o755);
  }
}
if (check) {
  for (const name of payloads.filter(name => !['features-meta.json', 'runtime-version.json', 'uninstall.sh', 'uninstall.ps1'].includes(name))) {
    if (!existsSync(join(root, 'src', 'shared', name))) throw new Error(`Missing runtime source: ${name}`);
  }
} else {
  const dist = join(root, 'dist');
  mkdirSync(dist, { recursive: true });
  const stage = mkdtempSync(join(tmpdir(), 'clawgod-build-'));
  try {
    for (const name of payloads) {
      if (['features-meta.json', 'runtime-version.json'].includes(name)) continue;
      copyFileSync(join(root, name.startsWith('uninstall.') ? 'src/templates' : 'src/shared', name), join(stage, name));
    }
    copyFileSync(join(root, 'src/shared/features.json'), join(stage, 'features.json'));
    writeFileSync(join(stage, 'features-meta.json'), JSON.stringify(featuresMeta(), null, 2) + '\n');
    const version = JSON.parse(readFileSync(join(root, 'src/shared/runtime-version.json'), 'utf8'));
    writeFileSync(join(stage, 'runtime-version.json'), JSON.stringify({ ...version, version: tag?.slice(1) || version.version, bun: project.engines.bun }) + '\n');
    const archive = join(dist, 'clawgod-runtime.tar.gz');
    const result = spawnSync('tar', ['-czf', archive, '-C', stage, ...readdirSync(stage).sort()], { stdio: 'inherit', windowsHide: true });
    if (result.error || result.status !== 0) throw new Error(`Cannot create runtime archive: ${result.error?.message || result.status}`);
    const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
    writeFileSync(join(dist, 'SHA256SUMS'), `${digest}  clawgod-runtime.tar.gz\n`);
    console.log('Built dist/clawgod-runtime.tar.gz and dist/SHA256SUMS');
  } finally {
    if (dirname(stage) !== tmpdir()) throw new Error('Unexpected build staging path');
    rmSync(stage, { recursive: true, force: true });
  }
}
