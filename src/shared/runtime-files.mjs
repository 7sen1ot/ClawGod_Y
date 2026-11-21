export const payloads = [
  'install-runtime.mjs', 'runtime-files.mjs', 'import.mjs',
  'extract-natives.mjs', 'post-process.mjs', 'openai-proxy.mjs', 'cli.mjs',
  'startup-check.mjs', 'runtime-helpers.mjs', 'prompt-runtime.mjs', 'bun-ant-shim.mjs',
  'patch.mjs', 'patch-rules.mjs', 'ast-patches.mjs', 'ast-helpers.mjs',
  'pentest-patches.mjs', 'pentest-scanners.mjs', 'pentest-prompts.mjs', 'pentest-trimming.mjs',
  'pentest-policy-text.mjs', 'pentest-pruner.mjs', 'lean-mode.mjs', 'compile-runtime.mjs',
  'patch-registry.mjs', 'npm-fetch.mjs', 'system-prompt.md', 'acorn.mjs', 'acorn.LICENSE',
  'features-meta.json', 'runtime-version.json', 'uninstall.sh', 'uninstall.ps1',
];

export const obsoleteFiles = [
  'cli.cjs', 'openai-proxy.cjs', 'startup-check.cjs', 'runtime-helpers.cjs', 'prompt-runtime.cjs',
  'bun-ant-shim.cjs', 'feature-gates.cjs', 'lean-mode.cjs', 'lean-apply.cjs', 'clawgod-import', 'clawgod-import.exe',
  'cli.js', 'patch.js', 'repatch.mjs', 'install.sh', 'install.ps1', '.lean-disabled', '.lean-max',
  'patches.json', 'feature-gates.mjs',
];

export const generatedFiles = [
  'cli.original.cjs', 'cli.original.cjs.bak', 'cli.original.js', 'cli.original.js.bak',
  '.source-version', '.clawgod-version', 'source-backup.json', 'pathmap.json',
  'lean-settings.json', 'claude.fallback', 'claude.fallback.exe', 'claude.staged', 'claude.staged.exe',
  'generated-probes.mjs', '.compiled-runtime', '.compiled-runtime-cache.json',
  'uninstall.sh', 'uninstall.ps1', 'startup-check.log', 'probe-tools.log',
];

export const runtimeDirectories = ['bunfs', 'vendor', 'node_modules', 'bun-runtime'];
