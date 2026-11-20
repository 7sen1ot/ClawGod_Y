import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { defaultProviderConfig, resolveProviderConfig, readJsonConfig, detectGrokKey } from './runtime-helpers.mjs';

const configFile = join(homedir(), '.clawgod', 'provider.json');

function writeConfig(config) {
  resolveProviderConfig(config);
  mkdirSync(join(homedir(), '.clawgod'), { recursive: true });
  writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  console.error(`Wrote ${configFile}`);
}

async function models(key, baseURL) {
  const url = new URL(baseURL);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('baseURL must be an HTTP(S) API base without credentials, query, or fragment');
  }
  url.pathname = url.pathname.replace(/\/+$/, '') + '/models';
  const response = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`/models returned HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body.data)) throw new Error('/models did not return a model list');
  return body.data.map(model => model.id).filter(id => typeof id === 'string');
}

export async function runImport(args) {
  const [command, ...options] = args;
  if (!command || ['help', '-h', '--help'].includes(command)) {
    console.error('Usage: clawgod import <grok|openai-chat|status|reset>\nAliases: openai-compat, openai -> openai-chat\nOptions: -k/--key KEY, -u/--base-url URL, -m/--model MODEL, --small-model MODEL');
    return;
  }
  if (command === 'reset' || command === 'status') {
    if (options.length) throw new Error(`${command} does not accept options`);
    if (command === 'reset') return writeConfig(defaultProviderConfig);
    const config = resolveProviderConfig(readJsonConfig(configFile));
    console.error(JSON.stringify({ protocol: config.protocol, model: config.model, smallModel: config.smallModel,
      baseURL: config.baseURL, apiKey: config.apiKey ? '(set)' : '(empty)', effort: config.effort, timeoutMs: config.timeoutMs }, null, 2));
    if (config.useProxy && config.apiKey) console.error(`Verified: ${(await models(config.apiKey, config.baseURL)).length} models`);
    return;
  }
  if (!['grok', 'openai-chat', 'openai-compat', 'openai'].includes(command)) throw new Error(`Unknown provider: ${command}`);
  const aliases = { '-k': 'apiKey', '--key': 'apiKey', '-u': 'baseURL', '--base-url': 'baseURL',
    '-m': 'model', '--model': 'model', '--small-model': 'smallModel' };
  const values = {};
  for (let i = 0; i < options.length; i++) {
    const field = aliases[options[i]];
    if (!field || !options[i + 1] || options[i + 1].startsWith('-')) throw new Error(`Invalid or missing option value: ${options[i]}`);
    values[field] = options[++i];
  }
  let input;
  const ask = async label => {
    if (!process.stdin.isTTY) throw new Error(`Missing ${label}; supply it with an option when stdin is not interactive`);
    input ??= createInterface({ input: process.stdin, output: process.stderr });
    return (await input.question(`${label}: `)).trim();
  };
  try {
    const grok = command === 'grok';
    const apiKey = values.apiKey || (grok && detectGrokKey()) || await ask('API key');
    const baseURL = values.baseURL || (grok ? 'https://api.x.ai/v1' : await ask('Base URL'));
    if (!apiKey || !baseURL) throw new Error('API key and base URL are required');
    // Validate the URL even for providers that do not expose /models.
    const url = new URL(baseURL);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid API base URL');
    let available = [];
    try { available = await models(apiKey, baseURL); }
    catch (error) {
      if (grok) throw error;
      console.error(`${error.message}; continuing because some compatible APIs do not expose /models.`);
    }
    let model = values.model;
    if (!model) {
      const fallback = grok ? 'grok-4' : available[0] || '';
      if (available.length) console.error(available.map((id, i) => `[${i + 1}] ${id}`).join('\n'));
      const choice = await ask(`Model${fallback ? ` [${fallback}]` : ''}`);
      model = available[Number(choice) - 1] || choice || fallback;
    }
    if (!model) throw new Error('Model is required');
    const smallModel = values.smallModel || (grok ? available.find(id => ['grok-3-mini', 'grok-3-mini-fast'].includes(id)) || 'grok-3-mini' : model);
    writeConfig({ ...defaultProviderConfig, protocol: 'openai-chat', apiKey, baseURL, model, smallModel });
    console.error('Done. Run `clawgod` to start.');
  } finally { input?.close(); }
}

if (import.meta.main) {
  try { await runImport(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
