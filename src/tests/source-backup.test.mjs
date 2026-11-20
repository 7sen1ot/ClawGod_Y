import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { requiredRuntime } from './required-runtime.fixture.mjs';

test('source-backup.test', async () => {

const root = mkdtempSync(join(tmpdir(), 'clawgod-source-backup-'));
const command = requiredRuntime + 'function userType(){return"external"}';
const colors = 'const color="rgb(215,119,87)";';
try {
  for (const graph of [false, true]) {
    const dir = join(root, graph ? 'graph' : 'legacy');
    mkdirSync(dir);
    for (const name of ['patch.mjs', 'patch-rules.mjs', 'patch-registry.mjs', 'ast-patches.mjs', 'ast-helpers.mjs', 'acorn.mjs', 'pentest-patches.mjs', 'pentest-scanners.mjs', 'pentest-prompts.mjs', 'pentest-trimming.mjs', 'pentest-policy-text.mjs', 'pentest-pruner.mjs', 'runtime-helpers.mjs', 'prompt-runtime.mjs']) {
      copyFileSync(new URL(`../shared/${name}`, import.meta.url), join(dir, name));
    }
    const entry = join(dir, 'cli.original.cjs');
    if (graph) mkdirSync(join(dir, 'bunfs'));
    const target = graph ? join(dir, 'bunfs/commands.js') : entry;
    const snapshot = join(dir, 'source-backup.json');
    const writeSource = (version, body = command) => {
      writeFileSync(entry, `// Version: ${version}\n${graph ? '// entry' : body + colors}`);
      if (graph) {
        writeFileSync(target, body);
        writeFileSync(join(dir, 'bunfs/colors.mjs'), colors);
        writeFileSync(join(dir, 'bunfs/asset.txt'), 'unchanged asset');
        writeFileSync(join(dir, 'pathmap.json'), JSON.stringify({
          '/$bunfs/root/commands.js': { path: 'bunfs/commands.js', loader: 'js' },
          '/$bunfs/root/colors.mjs': { path: 'bunfs/colors.mjs', loader: 'js' },
          '/$bunfs/root/asset.txt': { path: 'bunfs/asset.txt', loader: 'text' },
        }));
      }
    };
    const run = (...args) => spawnSync(process.execPath, [join(dir, 'patch.mjs'), ...args], { encoding: 'utf8' });
    const succeeds = (...args) => {
      const result = run(...args);
      assert.equal(result.status, 0, result.stderr + result.stdout);
      return result.stdout;
    };

    writeSource('2.1.283');
    const clean = readFileSync(target, 'utf8');
    succeeds('--capture-clean-source');
    const backup = readFileSync(snapshot, 'utf8');
    const first = succeeds();
    const patched = readFileSync(target, 'utf8');
    assert.match(patched, /return"ant"/);
    assert.notEqual(patched, clean);
    for (let attempt = 0; attempt < 3; attempt++) {
      writeFileSync(join(dir, '.compiled-runtime'), 'cli.compiled-old\n');
      const output = succeeds();
      assert.equal(existsSync(join(dir, '.compiled-runtime')), false, 'Repatching must invalidate compiled startup code');
      assert.equal(output.match(/Result: .*/)[0], first.match(/Result: .*/)[0]);
      assert.equal(readFileSync(target, 'utf8'), patched, 'no nested or duplicate patches');
      assert.equal(readFileSync(snapshot, 'utf8'), backup, 'clean backup stays clean');
    }
    succeeds('--revert');
    assert.equal(readFileSync(target, 'utf8'), clean);
    if (graph) assert.equal(readFileSync(join(dir, 'bunfs/colors.mjs'), 'utf8'), colors);
    succeeds();
    assert.equal(readFileSync(target, 'utf8'), patched);

    writeFileSync(snapshot, '{truncated');
    assert.equal(run().status, 1);
    assert.equal(readFileSync(target, 'utf8'), patched);
    writeFileSync(snapshot, backup);
    if (graph) {
      writeFileSync(join(dir, 'bunfs/extra.js'), '// mismatched graph');
      const pathMapFile = join(dir, 'pathmap.json');
      const pathMap = JSON.parse(readFileSync(pathMapFile, 'utf8'));
      pathMap['/$bunfs/root/extra.js'] = { path: 'bunfs/extra.js', loader: 'js' };
      writeFileSync(pathMapFile, JSON.stringify(pathMap));
      assert.equal(run().status, 1);
      assert.equal(readFileSync(target, 'utf8'), patched);
      rmSync(join(dir, 'bunfs/extra.js'));
      delete pathMap['/$bunfs/root/extra.js'];
      writeFileSync(pathMapFile, JSON.stringify(pathMap));
    }
    writeSource('2.1.284');
    assert.equal(run().status, 1, 'reject mismatched backup version');
    succeeds('--capture-clean-source');
    assert.equal(JSON.parse(readFileSync(snapshot)).version, '2.1.284');
    assert.match(readFileSync(entry + '.bak', 'utf8'), /Version: 2.1.284/);
    succeeds();

    rmSync(snapshot);
    rmSync(entry + '.bak');
    writeSource('2.1.284', 'const unsupported="fixture";');
    writeFileSync(join(dir, 'system-prompt.md'), 'Fixture prompt.\n');
    const before = readFileSync(target, 'utf8');
    for (const args of [[], ['--dry-run']]) {
      const failed = run(...args);
      assert.equal(failed.status, 1);
      assert.match(failed.stdout, /required runtime hook did not match/);
      assert.equal(readFileSync(target, 'utf8'), before);
      assert.equal(existsSync(entry + '.bak'), false);
      if (graph) assert.equal(readFileSync(join(dir, 'bunfs/colors.mjs'), 'utf8'), colors);
    }
  }
  console.log('[source-backup.test] clean backups, patching, and incompatible snapshot rejection passed');
} finally {
  rmSync(root, { recursive: true, force: true });
}

});
