module.exports = function resolveVersions(installer, lookup) {
  const pinned = installer.match(/^VERSION="(\d+\.\d+\.\d+)"\r?$/m)?.[1];
  if (!pinned) throw new Error('Default Claude version is missing');
  const versions = new Map([[pinned, [pinned]]]);
  for (const channel of lookup ? ['stable', 'latest'] : []) {
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

if (require.main === module) {
  const { appendFileSync } = require('node:fs');
  const main = async () => {
    const fullMatrix = ['schedule', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME) ||
      process.env.GITHUB_REF?.startsWith('refs/tags/');
    let lookup;
    if (fullMatrix) {
      const response = await fetch('https://registry.npmjs.org/-/package/@anthropic-ai/claude-code/dist-tags');
      if (!response.ok) throw new Error(`npm dist-tags returned HTTP ${response.status}`);
      const tags = await response.json();
      lookup = channel => tags[channel];
    }
    const result = module.exports(await Bun.file('src/templates/install.sh').text(), lookup);
    appendFileSync(process.env.GITHUB_OUTPUT, `default=${result.defaultVersion}\nversions=${JSON.stringify(result.versions)}\n`);
  };
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
