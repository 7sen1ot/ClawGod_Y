module.exports = function resolveVersions(lookup) {
  const latest = lookup('latest')?.trim();
  if (!/^\d+\.\d+\.\d+$/.test(latest)) throw new Error(`Invalid latest version: ${latest}`);
  return {
    latestVersion: latest,
    versions: [{ version: latest, channels: 'latest' }],
  };
};

if (require.main === module) {
  const { appendFileSync } = require('node:fs');
  const main = async () => {
    const response = await fetch('https://registry.npmjs.org/-/package/@anthropic-ai/claude-code/dist-tags');
    if (!response.ok) throw new Error(`npm dist-tags returned HTTP ${response.status}`);
    const tags = await response.json();
    const result = module.exports(channel => tags[channel]);
    appendFileSync(process.env.GITHUB_OUTPUT, `latest=${result.latestVersion}\nversions=${JSON.stringify(result.versions)}\n`);
  };
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
