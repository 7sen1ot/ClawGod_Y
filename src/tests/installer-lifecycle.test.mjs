import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { payloads } from '../install-files.mjs';
import { featuresMeta } from '../shared/patch-registry.mjs';

test('installer-lifecycle.test', async () => {

const root = mkdtempSync(join(tmpdir(), 'clawgod lifecycle-'));
const home = join(root, 'profile space 测试');
const runtime = join(root, 'runtime');
const dir = join(home, '.clawgod');
const bin = join(home, '.local', 'bin');
const windows = process.platform === 'win32';
const launcher = join(bin, windows ? 'clawgod.cmd' : 'clawgod');
const commands = join(root, 'commands');
const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: commands + (windows ? ';' : ':') + process.env.PATH };
const savedPath = windows ? spawnSync('powershell.exe', ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('Path','User')"], { encoding: 'utf8' }).stdout.trimEnd() : '';
function run(args = [], extra = {}) {
  return spawnSync(process.execPath, [join(runtime, 'install-runtime.mjs'), ...args], {
    env: { ...env, ...extra }, encoding: 'utf8', timeout: 60_000,
  });
}
try {
  mkdirSync(runtime, { recursive: true });
  mkdirSync(commands);
  writeFileSync(join(commands, 'rg'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  for (const name of payloads) {
    if (['features-meta.json', 'runtime-version.json'].includes(name)) continue;
    copyFileSync(new URL(name.startsWith('uninstall.') ? '../templates/' + name : '../shared/' + name, import.meta.url), join(runtime, name));
  }
  copyFileSync(new URL('../shared/features.json', import.meta.url), join(runtime, 'features.json'));
  writeFileSync(join(runtime, 'features-meta.json'), JSON.stringify(featuresMeta()));
  writeFileSync(join(runtime, 'runtime-version.json'), JSON.stringify({ version: '0.0.0-ci', upstreamVersion: 'stable',
    bun: JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).engines.bun }));
  writeFileSync(join(runtime, 'npm-fetch.mjs'), `import{mkdirSync,copyFileSync,writeFileSync}from'node:fs';import{join}from'node:path';
    if(process.env.CLAWGOD_FAIL_STAGE==='download')throw Error('fixture download failure');
    const requested=process.argv[2].split('@').at(-1),version=requested==='latest'?'2.1.329':requested==='stable'?'2.1.309':requested;
    const out=join(process.argv[3],'package');mkdirSync(out,{recursive:true});
    copyFileSync(process.execPath,join(out,process.platform==='win32'?'claude.exe':'claude'));
    writeFileSync(join(out,'package.json'),JSON.stringify({version}));`);
  writeFileSync(join(runtime, 'extract-natives.mjs'), `import{mkdirSync,writeFileSync}from'node:fs';import{join}from'node:path';
    const dir=process.argv[3];mkdirSync(join(dir,'bunfs'));writeFileSync(join(dir,'bunfs/asset.txt'),'asset');
    if(process.env.CLAWGOD_FAIL_STAGE==='extract')throw Error('fixture extraction failure');`);
  writeFileSync(join(runtime, 'post-process.mjs'), `import{writeFileSync}from'node:fs';
    if(process.env.CLAWGOD_FAIL_STAGE==='post-process')throw Error('fixture post-process failure');
    writeFileSync(new URL('./cli.original.cjs',import.meta.url),${JSON.stringify(`
if(process.env.CLAWGOD_FAIL_STAGE==='startup')process.exit(7);
console.log(require('fs').readFileSync(require('path').join(__dirname,'.source-version'),'utf8').trim()+' (ClawGod_Y)');`)});`);
  writeFileSync(join(runtime, 'patch.mjs'), `import{writeFileSync}from'node:fs';
    if(process.env.CLAWGOD_FAIL_STAGE==='patch')throw Error('fixture patch failure');
    writeFileSync(new URL('./generated-probes.mjs',import.meta.url),${JSON.stringify(`export async function loadProbes(){
      if(process.env.CLAWGOD_FAIL_STAGE==='probe')throw Error('fixture probe failure');
      globalThis.__clawgodTables={tools:[()=>[{name:'FixtureTool'}]],commands:[()=>[{name:'fixture'}]]};}`)});`);
  writeFileSync(join(runtime, 'compile-runtime.mjs'), '');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, windows ? 'claude.cmd' : 'claude'), 'official CLI must stay untouched');
  for (const requested of [undefined, 'latest', 'stable', '2.1.316']) {
    const result = run(requested ? [requested] : []);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const expected = requested === 'latest' ? '2.1.329' : !requested || requested === 'stable' ? '2.1.309' : requested;
    assert.equal(readFileSync(join(dir, '.source-version'), 'utf8').trim(), expected);
    assert.equal(readFileSync(join(bin, windows ? 'claude.cmd' : 'claude'), 'utf8'), 'official CLI must stay untouched');
    assert.ok(existsSync(launcher));
  }
  writeFileSync(join(dir, 'provider.json'), '{"protocol":"anthropic","model":"keep-me"}\n');
  mkdirSync(join(dir, 'state'), { recursive: true });
  writeFileSync(join(dir, 'state/session'), 'keep session');
  const before = Object.fromEntries(['cli.mjs', 'cli.original.cjs', '.source-version', 'provider.json', 'bunfs/asset.txt'].map(name => [name, readFileSync(join(dir, name), 'utf8')]));
  const priorLauncher = readFileSync(launcher, 'utf8');
  for (const stage of ['download', 'extract', 'post-process', 'patch', 'startup', 'probe']) {
    const result = run(['latest'], { CLAWGOD_FAIL_STAGE: stage });
    assert.notEqual(result.status, 0, `Expected ${stage} to abort`);
    for (const [name, content] of Object.entries(before)) assert.equal(readFileSync(join(dir, name), 'utf8'), content, `${stage}: ${name}`);
    assert.equal(readFileSync(launcher, 'utf8'), priorLauncher);
    assert.equal(readdirSync(home).some(name => name.startsWith('.clawgod-rollback-')), false);
  }
  for (const args of [['bad'], ['latest', 'extra']]) assert.notEqual(run(args).status, 0);
  assert.equal(run(['--uninstall']).status, 0);
  assert.equal(existsSync(launcher), false);
  assert.equal(existsSync(join(dir, 'cli.mjs')), false);
  assert.equal(readFileSync(join(dir, 'provider.json'), 'utf8'), before['provider.json']);
  assert.equal(readFileSync(join(dir, 'state/session'), 'utf8'), 'keep session');
} finally {
  if (windows) spawnSync('powershell.exe', ['-NoProfile', '-Command', "[Environment]::SetEnvironmentVariable('Path',$env:CLAWGOD_RESTORE_PATH,'User')"], {
    env: { ...process.env, CLAWGOD_RESTORE_PATH: savedPath }, windowsHide: true,
  });
  rmSync(root, { recursive: true, force: true });
}

});
