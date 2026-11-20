import { test } from 'bun:test';
import { runRuntimeFixture } from './runtime-sandbox.fixture.mjs';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

test('updater.test', async () => {

const require = createRequire(import.meta.url);
const wrapper = fs.readFileSync(new URL('../shared/cli.mjs', import.meta.url), 'utf8');
const home = fs.mkdtempSync(join(tmpdir(), 'clawgod-updater-test-'));
const bundleDir = join(home, 'installation');
const dir = join(home, '.clawgod');
fs.mkdirSync(dir);

try {
  fs.mkdirSync(bundleDir);
  fs.writeFileSync(join(bundleDir, 'system-prompt.md'), 'Fixture prompt.\n');
  for (const mode of ['on', 'off', 'max']) {
    for (const marker of ['.lean-disabled', '.lean-max']) fs.rmSync(join(dir, marker), { force: true });
    if (mode !== 'on') fs.writeFileSync(join(dir, mode === 'off' ? '.lean-disabled' : '.lean-max'), '');
    for (const inherited of [undefined, '', '0', 'false', '1']) {
      const env = inherited === undefined ? {} : { DISABLE_AUTOUPDATER: inherited };
      let loaded = false;
      runRuntimeFixture(wrapper, {
        __dirname: bundleDir,
        process: { argv: ['bun', 'cli.mjs'], env, execPath: '/test/bun', stderr: { write() {} } },
        require(name) {
          if (name === 'os') return { homedir: () => home };
          if (name === './cli.original.cjs') {
            assert.equal(env.DISABLE_AUTOUPDATER, '1', `${mode}, inherited=${inherited}`);
            loaded = true;
            return {};
          }
          if (name === './runtime-helpers.mjs') return require('../shared/runtime-helpers.mjs');
          if (['./feature-gates.mjs', './bun-ant-shim.mjs'].includes(name)) return {};
          return require(name);
        },
      });
      assert.ok(loaded);
    }
  }
  console.log('[updater.test] native auto-updates disabled before bundle load in every Lean mode');
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

});
