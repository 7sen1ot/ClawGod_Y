#!/usr/bin/env bun
import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
const modulePath = fileURLToPath(import.meta.url);
const runtimeDir = process.env.CLAWGOD_RUNTIME_DIR || (/(?:^|[\\/])(?:\$bunfs|~BUN)[\\/]/.test(modulePath)
  ? dirname(process.execPath) : dirname(modulePath));
process.env.CLAWGOD_RUNTIME_DIR ??= runtimeDir;

const clawgodDir = join(homedir(), '.clawgod');
if (process.argv[2] === 'import') {
  try { await (await import('./import.mjs')).runImport(process.argv.slice(3)); }
  catch (error) { console.error('[clawgod] ' + error.message); process.exit(1); }
  process.exit(0);
}
if (process.argv.length === 3 && process.argv[2] === '--uninstall') {
  await (await import('./install-runtime.mjs')).uninstallRuntime();
  process.exit(0);
}
if (['update', 'upgrade'].includes(process.argv[2])) {
  process.stderr.write('[clawgod] This command has been removed. Use --version to query the version or --uninstall to uninstall.\n');
  process.exit(2);
}
const versionOnly = process.argv.length === 3 && ['--version', '-v'].includes(process.argv[2]);

const probeTools = process.argv.length === 3 && process.argv[2] === '--probe-tools';

// Share Claude configuration; redirect session files through the direct-file backend.
process.env.CLAUDE_CODE_HOVER_REST = '0';
const { defaultProviderConfig: defaultConfig, resolveProviderConfig, readJsonConfig, detectGrokKey } = await import('./runtime-helpers.mjs');

let config = defaultConfig;
let resolved;
if (!versionOnly && !probeTools) {
  mkdirSync(join(clawgodDir, 'state'), { recursive: true });
  const configFile = join(clawgodDir, 'provider.json');
  try {
    if (existsSync(configFile)) {
      config = JSON.parse(readFileSync(configFile, 'utf8').replace(/^\uFEFF/, ''));
    } else {
      writeFileSync(configFile, JSON.stringify(defaultConfig, null, 2) + '\n');
    }
    resolved = resolveProviderConfig(config);
  } catch (error) {
    throw new Error('[clawgod] Cannot load ' + configFile + ': ' + error.message);
  }
} else {
  resolved = resolveProviderConfig(defaultConfig);
}

if (!probeTools && resolved.useProxy) {
  let _proxyKey = resolved.apiKey || '';
  if (!_proxyKey && resolved.legacyType === 'grok') _proxyKey = detectGrokKey(process.env, homedir());
  if (resolved.baseURL === 'https://api.anthropic.com' || !resolved.baseURL) {
    if (resolved.legacyType === 'grok') resolved.baseURL = 'https://api.x.ai/v1';
    else throw new Error('[clawgod] openai-chat requires an explicit baseURL, for example https://example.com/v1');
  }
  if (_proxyKey) {
    const { startProxy } = await import('./openai-proxy.mjs');
    const _proxy = startProxy({
      apiKey: _proxyKey,
      baseURL: resolved.baseURL,
      model: resolved.model || '',
      effort: process.env.CLAUDE_CODE_EFFORT_LEVEL ?? resolved.effort,
      timeoutMs: process.env.API_TIMEOUT_MS ?? resolved.timeoutMs,
    });
    delete process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:' + _proxy.port;
    process.env.ANTHROPIC_AUTH_TOKEN = 'proxy-passthrough';
    if (resolved.model) process.env.ANTHROPIC_MODEL = resolved.model;
    if (resolved.smallModel) process.env.ANTHROPIC_SMALL_FAST_MODEL = resolved.smallModel;
    process.env.CLAUDE_CODE_ATTRIBUTION_HEADER = '0';
    process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS ??= '1';
    process.on('exit', function () { try { _proxy.stop(); } catch {} });
    process.stderr.write('[clawgod] OpenAI Chat Completions proxy on port ' + _proxy.port + '\n');
  } else {
    throw new Error('[clawgod] openai-chat requires an API key (grok also accepts GROK_API_KEY, XAI_API_KEY or ~/.grok/user-settings.json)');
  }
} else if (!probeTools && resolved.apiKey) {
  if (resolved.baseURL) process.env.ANTHROPIC_BASE_URL = resolved.baseURL;
  if (resolved.model) process.env.ANTHROPIC_MODEL = resolved.model;
  if (resolved.smallModel) process.env.ANTHROPIC_SMALL_FAST_MODEL = resolved.smallModel;
  if (resolved.baseURL && !/anthropic\.com/i.test(resolved.baseURL)) {
    delete process.env.ANTHROPIC_API_KEY;
    const existingToken = (process.env.ANTHROPIC_AUTH_TOKEN || '').trim();
    process.env.ANTHROPIC_AUTH_TOKEN = existingToken || resolved.apiKey;
  } else {
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.ANTHROPIC_API_KEY = resolved.apiKey;
  }
} else if (!probeTools && resolved.baseURL && resolved.baseURL !== 'https://api.anthropic.com') {
  process.env.ANTHROPIC_BASE_URL ??= resolved.baseURL;
}

if (!probeTools && resolved.effort) {
  process.env.CLAUDE_CODE_EFFORT_LEVEL ??= resolved.effort;
}

if (!probeTools && resolved.timeoutMs) {
  process.env.API_TIMEOUT_MS ??= String(resolved.timeoutMs);
}
process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC ??= '1';
process.env.DISABLE_TELEMETRY = '1';
process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS ??= '1';
process.env.DO_NOT_TRACK = '1';
process.env.DISABLE_ERROR_REPORTING = '1';
process.env.CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING = '1';
process.env.CLAUDE_CODE_ATTRIBUTION_HEADER ??= '0';
try { unlinkSync(join(clawgodDir, '.lean-disabled')); } catch {}
try { unlinkSync(join(clawgodDir, '.lean-max')); } catch {}
process.env.DISABLE_INSTALLATION_CHECKS ??= '1';
process.env.DISABLE_AUTOUPDATER = '1';
process.env.DISABLE_UPDATES = '1';
process.env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL ??= '1';
process.env.USE_BUILTIN_RIPGREP ??= '1';
process.env.BASH_DEFAULT_TIMEOUT_MS ??= '600000';
process.env.BASH_MAX_TIMEOUT_MS ??= '3600000';
process.env.BASH_MAX_OUTPUT_LENGTH ??= '150000';
process.env.MAX_THINKING_TOKENS ??= '31999';
process.env.MAX_MCP_OUTPUT_TOKENS ??= '200000';

const featuresFile = join(clawgodDir, 'features.json');
if (!process.env.CLAUDE_INTERNAL_FC_OVERRIDES) {
  const features = readJsonConfig(featuresFile, null);
  if (features !== null) process.env.CLAUDE_INTERNAL_FC_OVERRIDES = JSON.stringify(features);
}

const _realExecPath = process.env.CLAUDE_CODE_EXECPATH || process.execPath;
if (_realExecPath !== process.execPath) {
  Object.defineProperty(process, 'execPath', {
    value: _realExecPath,
    configurable: true,
  });
}

await import('./feature-gates.mjs');

await import('./bun-ant-shim.mjs');

const leanSettings = join(clawgodDir, 'lean-settings.json');
if (!versionOnly && !probeTools) {
  if (!existsSync(leanSettings)) {
    (await import('./lean-mode.mjs')).leanApply(leanSettings, undefined, join(clawgodDir, 'patches.json'));
  }
  if (!process.argv.some(a => a === '--settings' || a.startsWith('--settings='))) {
    const tui = readJsonConfig(leanSettings).tui ?? 'fullscreen';
    process.env.CLAUDE_CODE_NO_FLICKER ??= tui === 'default' ? '0' : '1';
    if (existsSync(leanSettings)) process.argv.push('--settings', leanSettings);
  }
  const builtinPromptFile = join(runtimeDir, 'system-prompt.md');
  let _customPrompt = '';
  try {
    _customPrompt = readFileSync(builtinPromptFile, 'utf8').trim();
    if (!_customPrompt) throw new Error('file is empty');
  } catch (error) {
    process.stderr.write('[clawgod] Cannot load required system-prompt.md: ' + error.message + '\n');
    process.exit(1);
  }
  let _identityMarkers;
  let _stripMemory;
  const _extra = readJsonConfig(join(clawgodDir, 'assembly.json'));
  if (Array.isArray(_extra.identityMarkers)) _identityMarkers = _extra.identityMarkers;
  _stripMemory = _extra.stripMemory;
  globalThis.__clawgodAssembly = Object.freeze({
    customPrompt: _customPrompt,
    requireCustomPrompt: true,
    stripMemory: _stripMemory,
    identityMarkers: _identityMarkers && Object.freeze(_identityMarkers.slice()),
  });
}

if (probeTools) {
  (async () => {
    try {
      await (await import('./generated-probes.mjs')).loadProbes();
      process.exit(await globalThis.__clawgodHelpers.probeToolTables());
    } catch (error) {
      process.stderr.write('[clawgod] probe-tools error: ' + error.message + '\n');
      process.exit(1);
    }
  })();
} else await import('./cli.original.cjs');
