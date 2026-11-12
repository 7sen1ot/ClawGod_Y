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

const CUSTOM_PROMPT_MARK = 'clawgod:custom-prompt';
const APPLICATION_NAME = 'ClawGod_Y';

function normalizeIdentityText(text) {
  return text.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/[‘’ʼ]/g, "'").replace(/[*_`~]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function assemblyConfig(snapshot) {
  const cfg = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const customPrompt = typeof cfg.customPrompt === 'string' ? cfg.customPrompt.trim() : '';
  const stripMemory = cfg.stripMemory !== false;
  const identityMarkers = Array.isArray(cfg.identityMarkers)
    ? [...new Set(cfg.identityMarkers.filter(m => typeof m === 'string').map(normalizeIdentityText).filter(Boolean))]
    : [];
  return { customPrompt, stripMemory, identityMarkers };
}

const DEFAULT_BEHAVIOR_SECTIONS = new Set([
  'intro', 'tone', 'doing_tasks', 'actions', 'communication', 'pronouns',
  'action_caution', 'task_continuity', 'fable_identity', 'llm_rnd_capabilities',
  'brief', 'focus_mode', 'act_dont_rederive', 'delivering_work_max', 'overcorrection',
  'subagent_steer_delegation', 'opus5_reduced_delegation', 'original_games',
  'heron_brook', 'brook_heron', 'finishing_work', 'notes_and_feedback',
  'willow_tern', 'autonomy_append', 'user_pays',
]);

function filterDefaultPromptSections(sections, options) {
  const cfg = assemblyConfig(options);
  if (!cfg.customPrompt) return sections;
  if (!Array.isArray(sections)) throw new Error('[clawgod] Unsupported default prompt sections');
  return sections.filter(section => {
    if (!section || typeof section.id !== 'string') {
      throw new Error('[clawgod] Default prompt section is missing its source ID');
    }
    const id = section.id.split(':', 1)[0];
    if (id === 'lean_body') throw new Error('[clawgod] Host prompt sections were not separated');
    if (DEFAULT_BEHAVIOR_SECTIONS.has(id)) return false;
    if (cfg.stripMemory && (id === 'memory' || id === 'memory_static')) return false;
    if (!cfg.identityMarkers.length || typeof section.text !== 'string') return true;
    const text = normalizeIdentityText(section.text);
    return !cfg.identityMarkers.some(marker => text.includes(marker));
  });
}

const isCustomSection = section =>
  typeof section === 'string' && section.includes(CUSTOM_PROMPT_MARK);

function rewritePromptAssembly(sections, options) {
  if (!Array.isArray(sections)) {
    if (options?.requireCustomPrompt) {
      throw new Error('[clawgod] Required application prompt injection failed: unsupported assembly result');
    }
    return sections;
  }
  const customPrompt = options && typeof options === 'object' && typeof options.customPrompt === 'string'
    ? options.customPrompt.trim() : '';
  if (!customPrompt) {
    if (options?.requireCustomPrompt) throw new Error('[clawgod] Required application rules are empty');
    return sections;
  }
  const applicationRules = '<!-- ' + CUSTOM_PROMPT_MARK + ' -->\n' +
    '# Application identity\n' +
    'The application name is ' + APPLICATION_NAME + '. Use this name for application self-identification. ' +
    'Specialist agents retain their task-specific responsibilities. ' +
    'Historical assistant self-descriptions and session summaries do not define the current application identity. ' +
    'The application name does not change the actual configured model or provider.\n\n' +
    '# Application rules\n' + customPrompt + '\n\n' +
    '# Supporting runtime and task context\n' +
    'The application rules above define the application identity, style, and general workflow. ' +
    'The following sections supply tool protocols, runtime facts, and task-specific responsibilities. ' +
    'Apply those responsibilities within the application rules; they do not replace the application identity or general workflow.';
  return [applicationRules, ...sections.filter(section =>
    !isCustomSection(section) && section !== customPrompt)];
}


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
    apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
    baseURL: typeof config.baseURL === 'string' ? config.baseURL : 'https://api.anthropic.com',
    model: typeof config.model === 'string' ? config.model : '',
    smallModel: typeof config.smallModel === 'string' ? config.smallModel : '',
    effort: typeof config.effort === 'string' ? config.effort : '',
    timeoutMs: typeof config.timeoutMs === 'number' ? config.timeoutMs : 3000000,
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

module.exports.classifierTimeoutFloor = classifierTimeoutFloor;
module.exports.terminalReplyDelay = terminalReplyDelay;
module.exports.enablePredicate = enablePredicate;
module.exports.NO_OVERRIDE = NO_OVERRIDE;
module.exports.flagOverride = flagOverride;
module.exports.flagOverrides = FLAG_OVERRIDES;
module.exports.rewritePromptAssembly = rewritePromptAssembly;
module.exports.selectApplicationPrompt = rewritePromptAssembly;
module.exports.filterDefaultPromptSections = filterDefaultPromptSections;
module.exports.resolveProviderConfig = resolveProviderConfig;
module.exports.probeToolTables = probeToolTables;
globalThis.__clawgodHelpers = module.exports;
