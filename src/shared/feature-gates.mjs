import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonConfig } from './runtime-helpers.mjs';
const runtimeDir = process.env.CLAWGOD_RUNTIME_DIR || dirname(fileURLToPath(import.meta.url));
const CLAWGOD_FEATURES_META = JSON.parse(readFileSync(join(runtimeDir, 'features-meta.json'), 'utf8'));

var CLAWGOD_RUNTIME_FEATURES = ['bun-ant-shim'];

var clawgodDir = join(homedir(), '.clawgod');

var _cfg = readJsonConfig(join(clawgodDir, 'patches.json'));
for (var _name in process.env) {
  if (_name.indexOf('CLAWGOD_FEATURE_') !== 0) continue;
  var _val = process.env[_name];
  if (_val !== 'true' && _val !== 'false') continue;
  _cfg[_name.slice('CLAWGOD_FEATURE_'.length).toLowerCase().replace(/_/g, '-')] = _val === 'true';
}

var _known = new Set([...CLAWGOD_RUNTIME_FEATURES, ...Object.values(CLAWGOD_FEATURES_META).flat()]);
for (var _k in _cfg) {
  if (!_known.has(_k)) process.stderr.write('[clawgod] warning: unknown feature "' + _k + '" in patches.json\n');
}

var _gate = {};
for (var _pid in CLAWGOD_FEATURES_META) {
  _gate[_pid] = CLAWGOD_FEATURES_META[_pid].some(feature => _cfg[feature] !== false);
}
for (var _feature of CLAWGOD_RUNTIME_FEATURES) {
  _gate[_feature] = _cfg[_feature] !== false;
}
globalThis.__clawgodPatches = _gate;
