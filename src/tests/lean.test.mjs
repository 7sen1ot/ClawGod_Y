import { test } from 'bun:test';
import { runRuntimeFixture } from './runtime-sandbox.fixture.mjs';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

test('lean.test', async () => {

const require = createRequire(import.meta.url);
const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const wrapper = read('../shared/cli.mjs');
const home = fs.mkdtempSync(join(tmpdir(), 'clawgod-lean-test-'));
const bundleDir = join(home, 'installation');
const dir = join(home, '.clawgod');
const settings = join(home, '.claude', 'settings.json');
const leanSettings = join(dir, 'lean-settings.json');
const trafficKey = 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC';
const originalSettings = { theme: 'dark', disableWorkflows: true,
  permissions: { allow: ['Read'], deny: ['Bash(custom)', 'CronCreate', 'ScheduleWakeup'] } };
const loadSettings = () => JSON.parse(fs.readFileSync(settings, 'utf8'));
const loadLean = () => JSON.parse(fs.readFileSync(leanSettings, 'utf8'));
const saveSettings = s => fs.writeFileSync(settings, JSON.stringify(s));

function reset() {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir);
  saveSettings(originalSettings);
}

function launch(args = [], env = {}, expectLoaded = args.length === 0) {
  const exit = Symbol('exit');
  let loaded = false;
  const proc = { argv: ['node', 'cli.mjs', ...args], env: { ...env }, execPath: '/test/bun',
    stderr: { write() {} }, exit(code) { assert.equal(code, 0); throw exit; } };
  try {
    runRuntimeFixture(wrapper, {
      __dirname: bundleDir,
      process: proc,
      require(name) {
        if (name === 'os') return { homedir: () => home };
        if (name === './cli.original.cjs') { loaded = true; return {}; }
        if (name === './runtime-helpers.mjs') return require('../shared/runtime-helpers.mjs');
        if (name === './lean-mode.mjs') return require('../shared/lean-mode.mjs');
        if (['./feature-gates.mjs', './bun-ant-shim.mjs'].includes(name)) return {};
        return require(name);
      },
    });
  } catch (error) {
    if (error !== exit) throw error;
  }
  assert.equal(loaded, expectLoaded);
  return proc;
}

const { leanApply, DENY, FLAGS, SETTINGS, LEGACY_SHARED_DENY } = require('../shared/lean-mode.mjs');

function checkStrict(s) {
  for (const k of FLAGS) assert.equal(s[k], true, k);
  for (const [k, v] of Object.entries(SETTINGS)) assert.deepEqual(s[k], v, k);
  for (const t of DENY) assert.ok(s.permissions.deny.includes(t), t);
}

try {
  fs.mkdirSync(join(home, '.claude'));
  fs.mkdirSync(bundleDir);
  fs.writeFileSync(join(bundleDir, 'system-prompt.md'), 'Fixture prompt.\n');

  assert.ok(!DENY.includes('ScheduleWakeup') && !DENY.includes('ReportFindings'));
  assert.ok(DENY.includes('EnterPlanMode') && LEGACY_SHARED_DENY.includes('ScheduleWakeup'));

  reset();
  leanApply(leanSettings, settings);
  checkStrict(loadLean());
  let s = loadSettings();
  assert.equal(s.theme, 'dark');
  assert.deepEqual(s.permissions.allow, ['Read']);
  assert.ok(s.permissions.deny.includes('Bash(custom)'));
  assert.ok(!s.permissions.deny.includes('CronCreate'), 'legacy managed deny removed from shared settings');
  assert.ok(!s.permissions.deny.includes('ScheduleWakeup'), 'legacy multi-agent deny removed from shared settings');
  assert.ok(!('disableWorkflows' in s), 'legacy managed flag removed from shared settings');
  const onceLean = fs.readFileSync(leanSettings, 'utf8');
  const onceShared = fs.readFileSync(settings, 'utf8');
  leanApply(leanSettings, settings);
  assert.equal(fs.readFileSync(leanSettings, 'utf8'), onceLean, 'lean file idempotent');
  assert.equal(fs.readFileSync(settings, 'utf8'), onceShared, 'shared file untouched on re-apply');

  reset();
  fs.writeFileSync(leanSettings, JSON.stringify({ disableWorkflows: false,
    permissions: { allow: ['Read'], deny: ['CronCreate'] } }));
  leanApply(leanSettings, settings);
  s = loadLean();
  assert.equal(s.disableWorkflows, false, 'user value preserved');
  assert.equal(s.disableRemoteControl, true, 'missing managed flag added');
  console.log('[lean.test] single strictest level: clawgod-scoped, fill-only, idempotent ok');

  const patches = join(dir, 'patches.json');
  reset();
  leanApply(leanSettings, undefined, patches);
  checkStrict(loadLean());
  assert.deepEqual(loadSettings(), originalSettings, 'installer settings remain scoped');

  for (const baseURL of ['https://api.anthropic.com', 'https://example.invalid']) {
    reset();
    fs.writeFileSync(join(dir, 'provider.json'), JSON.stringify({ baseURL }));
    assert.equal(launch().env[trafficKey], '1');
    checkStrict(loadLean());
    for (const explicit of ['1', '0', '']) {
      assert.equal(launch([], { [trafficKey]: explicit }).env[trafficKey], explicit);
    }
    assert.equal(launch([], { DISABLE_TELEMETRY: '1' }).env.DISABLE_TELEMETRY, '1');
  }
  console.log('[lean.test] provider parity and explicit environment settings ok');

  reset();
  let proc = launch();
  assert.ok(proc.argv.includes('--settings'), 'launcher must pass --settings');
  assert.equal(proc.argv[proc.argv.indexOf('--settings') + 1], leanSettings);
  assert.ok(fs.existsSync(leanSettings), 'missing lean file self-heals');
  reset();
  fs.writeFileSync(leanSettings, JSON.stringify({}));
  proc = launch(['--settings', '/custom/my-settings.json'], {}, true);
  assert.equal(proc.argv.filter(a => a === '--settings').length, 1, 'user --settings is not duplicated');
  assert.ok(!proc.argv.includes(leanSettings), 'user --settings wins over the clawgod one');
  console.log('[lean.test] --settings scoping and user override ok');
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

});
