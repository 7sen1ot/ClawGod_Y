'use strict';

function classifierTimeoutFloor(envValue) {
  if (typeof envValue === 'string' && envValue.trim() === '') return null;
  const value = Number(envValue);
  return Number.isFinite(value) ? value : null;
}

function terminalReplyDelay(querier, reader, now) {
  const parse = reader?.parse;
  if (parse?.mode !== 'NORMAL' || typeof parse.incomplete !== 'string') return 0;
  if (!/^\x1b(?:\[(?:\?[\d;]*)?)?$/.test(parse.incomplete)) return 0;
  if (!Array.isArray(querier?.queue) || !querier.queue.some((entry) =>
    entry?.kind === 'barrier' || (entry?.kind === 'sentinel' && entry.written !== false))) return 0;
  if (!Number.isFinite(now) || !Number.isFinite(reader.lastInputAt)) return 0;
  return Math.max(0, 2000 - Math.max(0, now - reader.lastInputAt));
}

function enablePredicate(original, id) {
  if (typeof original !== 'function') return original;
  const enable = value => typeof value === 'boolean' ? true : value;
  return function () {
    'use strict';
    const result = Reflect.apply(original, this, arguments);
    if (globalThis.__clawgodPatches?.[id] === false) return result;
    return result instanceof Promise ? result.then(enable) : enable(result);
  };
}

const fs = require('fs');
const os = require('os');
const path = require('path');

const sharedConfigDir = path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
const sessionStateDir = path.join(os.homedir(), '.clawgod', 'state');
const sessionEntries = new Set([
  'projects', 'history.jsonl', 'sessions', 'tasks', 'todos', 'teams',
  'plans', 'file-history', 'session-env', 'shell-snapshots', 'debug',
]);

function sessionPath(file) {
  if (typeof file !== 'string') return file;
  const relative = path.relative(sharedConfigDir, path.resolve(file));
  const first = relative.split(path.sep)[0];
  if (!sessionEntries.has(first)) return file;
  return path.join(sessionStateDir, relative);
}

function instructionFileFilter(original) {
  return function (file, type) {
    if (['User', 'Project', 'Local'].includes(type) &&
        typeof file === 'string' && /(?:^|[\\/])(?:CLAUDE|AGENTS)\.md$/i.test(file)) return true;
    return Reflect.apply(original, this, arguments);
  };
}

const NO_OVERRIDE = Symbol('clawgod:no-override');
const FLAG_OVERRIDES = (() => {
  const base = {
    tengu_destructive_command_warning: false,
    tengu_attempt_decision_shadow: false,
    tengu_bg_classifier_config: { useSmallFastModel: false, disableThinking: false, midTurnLlmDebounceMs: 0 },
    tengu_kairos_brief: false,
    tengu_amber_quartz_disabled: true,
    tengu_chrome_auto_enable: false,
    tengu_chrome_install_upsell: false,
    tengu_cowork_chrome_automode_default: false,
    tengu_desktop_upsell: false,
    tengu_violin_tip: false,
    tengu_vscode_feedback_survey: false,
    tengu_vscode_onboarding: false,
    tengu_vscode_review_upsell: false,
    tengu_c4e_slash_upsell: false,
  };
  for (const source of [
    () => JSON.parse(fs.readFileSync(path.join(os.homedir(), '.clawgod', 'flags.json'), 'utf8')),
    () => JSON.parse(process.env.CLAWGOD_FLAGS || '{}'),
  ]) {
    try {
      const extra = source();
      if (extra && typeof extra === 'object' && !Array.isArray(extra)) Object.assign(base, extra);
    } catch {}
  }
  return base;
})();

function flagOverride(flag) {
  if (typeof flag !== 'string') return NO_OVERRIDE;
  return flag in FLAG_OVERRIDES ? FLAG_OVERRIDES[flag] : NO_OVERRIDE;
}

const {
  rewritePromptAssembly, cleanPromptIdentity, prepareIdentityTemplate, cleanSummaryContent, cleanSummaryMessages,
  brandApplicationText, brandApplicationPattern, matchesApplicationText,
  filterDefaultPromptSections, refreshPromptSnapshot, finalizeSystemRequest, validateExtraBody,
} = require('./prompt-runtime.cjs');

const DEFAULT_PROVIDER_CONFIG = {
  protocol: 'anthropic',
  apiKey: '',
  baseURL: 'https://api.anthropic.com',
  model: '',
  smallModel: '',
  effort: '',
  timeoutMs: 3000000,
};

function resolveProviderConfig(raw) {
  const config = raw && typeof raw === 'object' ? raw : {};
  const protocol = config.protocol;
  if (protocol !== undefined && !['anthropic', 'openai-chat'].includes(protocol)) {
    throw new Error('[clawgod] Unsupported provider protocol: ' + protocol + '. Use anthropic or openai-chat; auto and Responses are not supported.');
  }
  const type = config.type;
  const useProxy = protocol === 'openai-chat' ||
    (protocol === undefined && ['grok', 'openai-compat'].includes(type));
  return {
    ...Object.fromEntries(Object.entries(DEFAULT_PROVIDER_CONFIG).map(([key, fallback]) =>
      [key, typeof config[key] === typeof fallback ? config[key] : fallback])),
    protocol: protocol || undefined,
    type: type || undefined,
    useProxy,
  };
}

async function probeToolTables() {
  try {
    const tables = globalThis.__clawgodTables;
    const counts = {};
    for (const kind of ['tools', 'commands']) {
      const factories = tables?.[kind];
      if (!Array.isArray(factories) || factories.length === 0) throw new Error(`${kind} factories not exposed`);
      counts[kind] = 0;
      for (const [index, factory] of factories.entries()) {
        if (typeof factory !== 'function') throw new Error(`${kind} factory ${index} is not callable`);
        const entries = await factory();
        if (!Array.isArray(entries) || entries.length === 0) throw new Error(`${kind} factory ${index} returned an empty or invalid table`);
        for (let i = 0; i < entries.length; i++) {
          if (entries[i] == null || typeof entries[i].name !== 'string' || !entries[i].name) {
            throw new Error(`${kind} factory ${index}, index ${i}: missing descriptor or name`);
          }
        }
        counts[kind] += entries.length;
      }
    }
    process.stderr.write('[clawgod] probe-tools ok: ' + counts.tools + ' tools, ' + counts.commands + ' commands\n');
    return 0;
  } catch (error) {
    process.stderr.write('[clawgod] probe-tools error: ' + (error?.message ?? error) + '\n');
    return 1;
  }
}

module.exports = {
  classifierTimeoutFloor, terminalReplyDelay, enablePredicate, sessionPath, instructionFileFilter,
  NO_OVERRIDE, flagOverride, flagOverrides: FLAG_OVERRIDES,
  rewritePromptAssembly, selectApplicationPrompt: rewritePromptAssembly,
  cleanPromptIdentity, prepareIdentityTemplate, cleanSummaryContent, cleanSummaryMessages,
  brandApplicationText, brandApplicationPattern, matchesApplicationText,
  filterDefaultPromptSections, refreshPromptSnapshot, finalizeSystemRequest, validateExtraBody,
  defaultProviderConfig: DEFAULT_PROVIDER_CONFIG, resolveProviderConfig, probeToolTables,
};
globalThis.__clawgodHelpers = module.exports;
