import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('compile-runtime.test', async () => {

const root = mkdtempSync(join(tmpdir(), 'clawgod compile-'));
const home = join(root, 'profile space \u6d4b\u8bd5');
const dir = join(home, '.clawgod');
const bun = process.env.CLAWGOD_TEST_BUN || (process.versions.bun ? process.execPath : 'bun');
const env = { ...process.env, HOME: home, USERPROFILE: home };
for (const key of Object.keys(env)) if (/^(?:ANTHROPIC_|CLAUDE_CODE_EXECPATH|GROK_API_KEY)/.test(key)) delete env[key];
const run = (command, args) => {
  const result = spawnSync(command, args, { env, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
  return result.stdout + result.stderr;
};
try {
  mkdirSync(join(dir, 'bunfs'), { recursive: true });
  for (const name of ['compile-runtime.mjs', 'cli.mjs', 'runtime-helpers.mjs', 'prompt-runtime.mjs', 'lean-mode.mjs', 'openai-proxy.mjs', 'import.mjs', 'install-runtime.mjs', 'runtime-files.mjs']) {
    copyFileSync(new URL('../shared/' + name, import.meta.url), join(dir, name));
  }
  writeFileSync(join(dir, 'bun-ant-shim.mjs'), '');
  writeFileSync(join(dir, 'system-prompt.md'), 'Fixture prompt.\n');
  const original = `if(['--version','-v'].includes(process.argv[2]))console.log('2.1.316 (ClawGod_Y)');
else console.log(JSON.stringify({args:process.argv.slice(2),text:require('fs').readFileSync(${JSON.stringify(join(dir, 'asset.txt'))},'utf8')}));`;
  writeFileSync(join(dir, 'cli.original.cjs'), original);
  writeFileSync(join(dir, 'asset.txt'), 'external text asset');
  writeFileSync(join(dir, 'bunfs/answer.cjs'), 'module.exports="FixtureTool";');
  writeFileSync(join(dir, 'bunfs/probe.cjs'), `const name=require('./answer.cjs');
globalThis.__clawgodTables={tools:[()=>[{name}]],commands:[()=>[{name:'fixture-command'}]]};`);
  writeFileSync(join(dir, 'generated-probes.mjs'), 'export async function loadProbes(){await import("./bunfs/probe.cjs");}');
  const source = ['--version', '--probe-tools'].map(arg => run(bun, [join(dir, 'cli.mjs'), arg]));
  const compiler = join(dir, 'compile-runtime.mjs');
  assert.match(run(bun, [compiler]), /Compiled startup runtime ready/);
  const marker = join(dir, '.compiled-runtime');
  const compiled = join(dir, readFileSync(marker, 'utf8').trim());
  assert.ok(existsSync(compiled));
  for (const [i, arg] of ['--version', '--probe-tools'].entries()) assert.equal(run(compiled, [arg]), source[i]);
  const args = ['fixture-argument', 'two words'];
  assert.equal(run(compiled, args), run(bun, [join(dir, 'cli.mjs'), ...args]), 'Compiled/source behavior and external assets must agree');
  rmSync(join(dir, 'generated-probes.mjs'));
  assert.match(run(bun, [compiler]), /Startup compilation skipped/);
  assert.equal(existsSync(marker), false, 'Failed compilation must invalidate the compiled marker');
  assert.equal(run(bun, [join(dir, 'cli.mjs'), '--version']), source[0], 'Source startup must remain usable');
  assert.deepEqual(readdirSync(dir).filter(name => name.startsWith('cli.compiled-')), [compiled.split(/[\\/]/).at(-1)], 'Failed builds must remove their partial output');
  assert.equal(readdirSync(dir).some(name => name.endsWith('.tmp')), false);
} finally { rmSync(root, { recursive: true, force: true }); }
console.log('[compile-runtime.test] compiled/source parity, local modules, external assets and failure fallback passed');

});
