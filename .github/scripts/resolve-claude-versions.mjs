import { appendFileSync } from 'node:fs';
export default function resolveVersions(installer, lookup, latestOnly = false) {
  let pinned;
  try { pinned = JSON.parse(installer).upstreamVersion; } catch {}
  if (!/^\d+\.\d+\.\d+$/.test(pinned)) throw new Error('Default Claude version is missing');
  const versions = new Map(latestOnly ? [] : [[pinned, [pinned]]]);
  const channels = latestOnly ? ['latest'] : ['stable', 'latest'];
  for (const channel of lookup ? channels : []) {
    const version = lookup(channel)?.trim();
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid ${channel} version: ${version}`);
    if (!versions.has(version)) versions.set(version, []);
    versions.get(version).push(channel);
  }
  return {
    defaultVersion: pinned,
    versions: [...versions].map(([version, channels]) => ({ version, channels: channels.join(', ') })),
  };
};

if (import.meta.main) {

  const main = async () => {
    const latestOnly = process.env.GITHUB_EVENT_NAME === 'schedule';
    const response = await fetch('https://registry.npmjs.org/-/package/@anthropic-ai/claude-code/dist-tags');
    if (!response.ok) throw new Error(`npm dist-tags returned HTTP ${response.status}`);
    const tags = await response.json();
    const result = resolveVersions(await Bun.file('src/shared/runtime-version.json').text(), channel => tags[channel], latestOnly);
    const tested = latestOnly ? result.versions[0].version : result.defaultVersion;
    appendFileSync(process.env.GITHUB_OUTPUT, `tested=${tested}\nversions=${JSON.stringify(result.versions)}\n`);
  };
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
