import { readFileSync } from 'node:fs';
import { PATCHES } from '../shared/patch-registry.mjs';

const [logPath, platform, versionArg] = process.argv.slice(2);
if (!logPath || !['linux', 'macos', 'windows'].includes(platform) || versionArg && !/^\d+\.\d+\.\d+$/.test(versionArg)) {
  throw new Error('Usage: bun check-patch-coverage.mjs <install-log> <linux|macos|windows> [claude-version]');
}

const bytes = readFileSync(logPath);
const log = bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8')
  .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
const start = log.lastIndexOf('Mode: APPLY');
const summary = start < 0 ? null : log.slice(start)
  .match(/Result:\s*(\d+) applied,\s*(\d+) skipped,\s*(\d+) failed/);
if (!summary) throw new Error('Patch APPLY result is missing from the install log');
const sourceVersion = log.slice(0, start).match(/Target: cli\.original\.cjs \(v(\d+\.\d+\.\d+)\)[^\n]*\s*$/)?.[1];
const installedVersion = versionArg || sourceVersion;
if (!installedVersion) throw new Error('Installed Claude version is missing from the install log');
if (versionArg && sourceVersion && versionArg !== sourceVersion) throw new Error('Claude version argument does not match the install log');

// Reviewed gaps in Claude 2.1.316 (actions/runs/41206844027) and stable 2.1.309.
// New versions must not silently inherit these exceptions.
const reviewed = Bun.semver.satisfies(installedVersion, '2.1.309 || 2.1.316');
const currentReviewed = Bun.semver.satisfies(installedVersion, '2.1.323 || 2.1.325 || 2.1.330 || 2.1.331 || 2.1.332');
const baseline = reviewed ? new Map([
  ['computer-use-gate-semantic', 'absent'],
  ['geo-stego-date', 'unverified'],
  ['permission-mcp-allowlist-off', 'absent'],
  ['computer-use-gate', 'unverified'],
  ['auto-mode-helper-gate', 'absent'],
  ['macos-cmdv-image-paste', 'stale'],
  ['restore-search-tools', platform === 'windows' ? 'stale' : 'absent'],
  ['geo-detect-probe', 'unverified'],
  ['geo-apostrophe-stego', 'absent'],
  ['remove-cautious-actions', 'unverified'],
]) : currentReviewed ? new Map([
  // Reviewed against extracted 2.1.323/2.1.330/2.1.331 sources and runs 44894960767/45392178058.
  // Stable 2.1.325 has the same reviewed gaps across all platforms (run 45405762804).
  // 2.1.332 retains these gaps (run 45722776006 and extracted sources).
  // The geo encoders/provider helper are absent; clipboard fallback is upstream.
  ['geo-stego-date', 'unverified'],
  ['geo-detect-probe', 'unverified'],
  ['geo-apostrophe-stego', 'absent'],
  ['auto-mode-helper-gate', 'absent'],
  ['macos-cmdv-image-paste', 'absent'],
]) : new Map();
if (reviewed && platform !== 'macos') {
  baseline.set('computer-use-default', 'unverified');
  baseline.set('computer-use-sub', 'unverified');
}
if (currentReviewed && platform !== 'macos') {
  // These native packages do not include the macOS Computer Use implementation.
  baseline.set('computer-use-default', 'unverified');
  baseline.set('computer-use-sub', 'unverified');
  baseline.set('computer-use-gate', 'unverified');
  baseline.set('computer-use-gate-semantic', 'absent');
}
const partialLimits = reviewed ? new Map([['ultraplan', 1]]) : new Map();

const expected = new Map(PATCHES.map(patch => [patch.id, patch]));
const results = new Map(), partials = new Map(), covered = [];
const errors = [];
if (expected.size !== PATCHES.length) errors.push('Patch registry contains duplicate IDs');
if (Number(summary[3]) !== 0) errors.push(`Patcher reported ${summary[3]} failed patches`);
const body = log.slice(start, start + summary.index);
let records = 0;
const observed = { applied: 0, skipped: 0, failed: 0 };
for (const raw of body.split(/\r?\n/)) {
  const status = raw.trim().match(/^(✅|⏭|⚠️|❌)\s+(.+)/u);
  if (!status) continue;
  const [, icon, text] = status;
  const partial = text.match(/^([\w-]+): (\d+) site\(s\) NOT patched/);
  if (partial) {
    const [, id, count] = partial;
    if (!expected.has(id) || partials.has(id) || Number(count) > (partialLimits.get(id) ?? 0)) errors.push(text);
    partials.set(id, Number(count));
    continue;
  }
  records++;
  observed[icon === '✅' ? 'applied' : icon === '❌' ? 'failed' : 'skipped']++;
  const record = text.match(/^\[([\w-]+)\]\s+(.+)/);
  if (!record) { errors.push(`Patch result is missing a rule ID: ${text}`); continue; }
  const [, id, message] = record;
  if (!expected.has(id)) { errors.push(`Unknown patch ID: ${id}`); continue; }
  if (results.has(id)) { errors.push(`Duplicate patch result: ${id}`); continue; }
  results.set(id, icon);
  const patch = expected.get(id);
  const partialCount = message.match(/, (\d+) site\(s\) left unpatched\)/);
  if (partialCount && Number(partialCount[1]) > (partialLimits.get(id) ?? 0)) errors.push(`[${id}] ${message}`);
  if (icon === '✅') continue;
  if (icon === '❌') { errors.push(`[${id}] ${message}`); continue; }
  const covering = message.match(/ \(covered by applied rule: ([\w-]+)\)$/);
  if (icon === '⏭' && covering) {
    const coveringId = covering[1];
    if (![...(patch.coveredBy ?? []), ...(patch.fallbackFor ?? [])].includes(coveringId)) {
      errors.push(`Undeclared covering rule: ${id} -> ${coveringId}`);
    }
    covered.push([id, coveringId]);
    continue;
  }
  const outOfRange = message.match(/ \(outside supported versions: (.+)\)$/);
  if (icon === '⏭' && outOfRange && patch.versions === outOfRange[1] &&
      !Bun.semver.satisfies(installedVersion, patch.versions)) continue;
  const missing = message.match(/ \((not present in this version|no matching anchor; application cannot be verified|0 matches, no sentinel — cannot verify)\)$/);
  const stale = / — (?:regex|AST matcher) stale,/.test(message);
  const state = stale ? 'stale' : missing?.[1] === 'not present in this version' ? 'absent' : 'unverified';
  if ((!missing && !stale) || baseline.get(id) !== state) errors.push(`New patch coverage gap: [${id}] ${message}`);
}
for (const id of expected.keys()) if (!results.has(id)) errors.push(`Missing patch result: ${id}`);
for (const [id, coveringId] of covered) {
  if (results.get(coveringId) !== '✅') errors.push(`Covering rule did not apply: ${id} -> ${coveringId}`);
}
for (const id of partials.keys()) {
  if (results.get(id) !== '✅') errors.push(`Partial coverage has no applied patch result: ${id}`);
}
if (records !== PATCHES.length || observed.applied === 0) errors.push(`Patch report is empty or incomplete (expected ${PATCHES.length} registered rules)`);
if (observed.applied !== Number(summary[1]) || observed.skipped !== Number(summary[2]) || observed.failed !== Number(summary[3])) {
  errors.push('Patch status counts do not match the summary');
}
if (body.includes('Runtime fallback installed;')) errors.push('New runtime fallback requires coverage review');
if (errors.length) {
  for (const error of errors) console.error(`::error::${error}`);
  process.exit(1);
}
console.log(`Patch coverage (${platform}, Claude ${installedVersion}, ${PATCHES.length} rules): ${summary[0]}; no new coverage gaps`);
