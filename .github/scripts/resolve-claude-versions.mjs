import { appendFileSync } from 'node:fs';
export default function resolveVersions(lookup, latestOnly = false) {
  const versions = new Map();
  for (const channel of latestOnly ? ['latest'] : ['stable', 'latest']) {
    const version = lookup(channel)?.trim();
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid ${channel} version: ${version}`);
    if (!versions.has(version)) versions.set(version, []);
    versions.get(version).push(channel);
  }
  return {
    defaultVersion: versions.keys().next().value,
    versions: [...versions].map(([version, channels]) => ({ version, channels: channels.join(', ') })),
  };
};

if (import.meta.main) {

  const main = async () => {
    const response = await fetch('https://registry.npmjs.org/-/package/@anthropic-ai/claude-code/dist-tags');
    if (!response.ok) throw new Error(`npm dist-tags returned HTTP ${response.status}`);
    const tags = await response.json();
    const result = resolveVersions(channel => tags[channel], process.env.GITHUB_EVENT_NAME === 'schedule');
    appendFileSync(process.env.GITHUB_OUTPUT, `tested=${result.defaultVersion}\nversions=${JSON.stringify(result.versions)}\n`);
  };
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
