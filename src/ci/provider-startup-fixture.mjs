import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
if (process.env.CI !== 'true') throw new Error('This fixture may only modify a disposable CI runner profile');
const dir = join(homedir(), '.clawgod');
const path = join(dir, 'provider.json');
const provider = {
  protocol: 'openai-chat',
  apiKey: 'ci-fixture-not-a-real-key', baseURL: 'http://127.0.0.1:9/v1', model: 'ci-fixture',
};
if (process.argv[2] === 'seed') {
  fs.mkdirSync(dir, { recursive: true });
  assert.ok(!fs.existsSync(path), 'Never overwrite an existing provider with the CI fixture');
  fs.writeFileSync(path, JSON.stringify(provider, null, 2) + '\n');
} else if (process.argv[2] === 'verify') {
  assert.deepEqual(JSON.parse(fs.readFileSync(path, 'utf8')), provider, 'Installer must preserve provider settings');
  const logs = [join(dir, 'startup-check.log'), ...process.argv.slice(3)];
  for (const log of logs) {
    const output = fs.readFileSync(log, 'utf8');
    assert.doesNotMatch(output, /proxy on port/i, 'Version probes must not start a provider listener');
  }
  assert.match(fs.readFileSync(logs[0], 'utf8'), /^\d+\.\d+\.\d+[^\r\n]*\(ClawGod_Y\)\s*$/m);
  console.log('Installed ClawGod_Y version check passed with configured provider; settings preserved');
} else throw new Error('Usage: provider-startup-fixture.mjs seed|verify [installer logs...]');
