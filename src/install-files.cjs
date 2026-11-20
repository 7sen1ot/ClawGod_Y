const runtimePayloads = [
  'extract-natives.mjs', 'post-process.mjs', 'openai-proxy.cjs', 'cli.cjs',
  'startup-check.cjs', 'runtime-helpers.cjs', 'prompt-runtime.cjs', 'bun-ant-shim.cjs',
  'feature-gates.cjs', 'patch.mjs', 'patch-rules.mjs', 'ast-patches.mjs', 'ast-helpers.mjs',
  'pentest-patches.mjs', 'pentest-scanners.mjs', 'pentest-prompts.mjs', 'pentest-trimming.mjs',
  'pentest-policy-text.mjs', 'pentest-pruner.mjs', 'lean-mode.cjs',
  'acorn.mjs', 'acorn.LICENSE',
];
// The Windows uninstaller tolerates removal failures for these payloads.
const bestEffortPayloads = ['compile-runtime.mjs', 'patch-registry.mjs', 'system-prompt.md'];

// The downloader runs in a temporary directory. features.json belongs to the user after seeding.
const sharedSources = Object.fromEntries(
  [...runtimePayloads, ...bestEffortPayloads, 'npm-fetch.mjs', 'features.json'].map(name => [name, 'shared/' + name]),
);
const windowsSources = {
  ...sharedSources,
  'lean-apply.cjs': 'windows/lean-apply.cjs',
};

function formatList(names) {
  return names.map(name => `    '${name}'`).join('\n');
}

function templateValuesFor(target, uninstallerSource) {
  const windows = target.endsWith('.ps1');
  const exe = windows ? '.exe' : '';
  const uninstaller = windows ? 'uninstall.ps1' : 'uninstall.sh';
  const directories = ['bunfs', 'vendor'];
  const files = [
    ...runtimePayloads, 'cli.original.cjs', 'cli.original.cjs.bak', 'cli.original.js',
    '.source-version', 'source-backup.json', 'pathmap.json', 'lean-settings.json', 'claude.fallback' + exe,
  ];
  const bestEffort = [...bestEffortPayloads, '.clawgod-version', '.compiled-runtime', '.compiled-runtime-cache.json'];
  if (target !== uninstaller) {
    return {
      'rollback-files': formatList([...files, ...bestEffort, ...directories, 'patches.json', uninstaller]),
      'standalone-uninstaller': windows ? Buffer.from(uninstallerSource).toString('base64') : uninstallerSource.replace(/\n$/, ''),
    };
  }

  const uninstallFiles = [
    ...files, 'npm-fetch.mjs', 'cli.original.js.bak', 'cli.js', 'patch.js', 'repatch.mjs', '.lean-disabled', '.lean-max',
    'startup-check.log', 'clawgod-import' + exe, 'claude.staged' + exe,
  ];
  const optionalFiles = [...bestEffort, 'probe-tools.log'];
  const lists = {
    'uninstall-files': formatList(windows ? uninstallFiles : [...uninstallFiles, ...optionalFiles]),
    'uninstall-dirs': formatList([...directories, 'node_modules', 'bun-runtime']),
  };
  if (windows) lists['uninstall-best-effort-files'] = formatList(optionalFiles);
  return lists;
}

module.exports = { sharedSources, windowsSources, templateValuesFor };
