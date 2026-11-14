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

const CUSTOM_PROMPT_MARK = 'clawgod:custom-prompt';
const IDENTITY_POLICY_VERSION = 8;
const CUSTOM_PROMPT_PREFIX = '<!-- ' + CUSTOM_PROMPT_MARK + ' -->\n';
const LEGACY_PROMPT_HEADER = '# Application identity\nThe application name is ClawGod_Y.';
const CUSTOM_PROMPT_END = '\n<!-- /' + CUSTOM_PROMPT_MARK + ' -->';
const assemblyConfigs = new WeakMap();

// Brand presentation text: source literals, system sections and tool descriptions.
// Conversation data, executable examples and functional identifiers stay intact.
function brandApplicationText(text) {
  if (typeof text !== 'string') return text;
  if (!/Claude Code|ClawGod\b|You are the Claude guide agent|(?:[Aa]sk|[Tt]ell) Claude/.test(text)) return text;
  let fence;
  return text.split(/(\r?\n)/).map(line => {
    if (/^\r?\n$/.test(line)) return line;
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = undefined;
      return line;
    }
    if (fence || /^(?: {4}|\t)/.test(line)) return line;
    // Upstream distribution surfaces are not capabilities of this application.
    if (/^Claude Code(?:_Y)? is available as a CLI\b/.test(line)) return 'ClawGod_Y runs as a CLI in the terminal.';
    return line.replace(/(`+)[\s\S]*?\1|https?:\/\/[^\s<>]+|\bClaude Code(?:_Y)?\b|\bClawGod\b|\bYou are the Claude guide agent\b|\b(?:[Aa]sk|[Tt]ell) Claude(?= to\b)/g, (match, delimiter, offset) => {
      if (/^`|^https?:/.test(match)) return match;
      if (/[\\/]$/.test(line.slice(0, offset)) || /^(?:[\\/]|\.[\w-]+(?:[\\/\s]|$))/.test(line.slice(offset + match.length))) return match;
      if (match === 'You are the Claude guide agent') return 'You are the ClawGod_Y guide agent';
      if (/^(?:Ask|ask|Tell|tell) Claude$/.test(match)) return match.replace('Claude', 'ClawGod_Y');
      return 'ClawGod_Y';
    });
  }).join('');
}

function cleanApplicationContext(text, options) {
  const cfg = assemblyConfig(options);
  if (!cfg.customPrompt || text === cfg.customPrompt) return text;
  return brandApplicationText(cleanPromptIdentity(text, options));
}

// Native parsers also recognize prose written by older sessions. Accept both
// spellings without changing raw regexp escapes or the numbering of captures.
function brandApplicationPattern(pattern) {
  const aliases = '(?:Claude Code(?:_Y)?|ClawGod_Y)';
  return pattern.split(aliases).map(part =>
    part.replace(/\b(?:Claude Code(?:_Y)?|ClawGod_Y)\b/g, aliases)).join(aliases);
}

function matchesApplicationText(value, method, text, ...rest) {
  const match = value[method];
  if (Reflect.apply(match, value, [text, ...rest])) return true;
  const branded = brandApplicationText(text);
  return branded !== text && Reflect.apply(match, value, [branded, ...rest]);
}

function brandToolDefinitions(tools) {
  if (!Array.isArray(tools)) return tools;
  const schemaText = schema => {
    if (!schema || typeof schema !== 'object') return schema;
    let result = schema;
    for (const [key, value] of Object.entries(schema)) {
      let next = value;
      if (['description', 'title'].includes(key) && typeof value === 'string') next = brandApplicationText(value);
      else if (['properties', '$defs', 'definitions', 'patternProperties', 'dependentSchemas'].includes(key) && value && typeof value === 'object') {
        const entries = Object.entries(value).map(([name, child]) => [name, schemaText(child)]);
        if (entries.some(([name, child]) => child !== value[name])) next = Object.fromEntries(entries);
      } else if (['items', 'additionalProperties', 'contains', 'not', 'if', 'then', 'else', 'propertyNames'].includes(key)) next = schemaText(value);
      else if (['allOf', 'anyOf', 'oneOf', 'prefixItems'].includes(key) && Array.isArray(value)) {
        const items = value.map(schemaText);
        if (items.some((item, i) => item !== value[i])) next = items;
      }
      if (next !== value) { if (result === schema) result = { ...schema }; result[key] = next; }
    }
    return result;
  };
  let changed = false;
  const result = tools.map(tool => {
    if (!tool || typeof tool !== 'object') return tool;
    const description = brandApplicationText(tool.description);
    const input_schema = schemaText(tool.input_schema);
    if (description === tool.description && input_schema === tool.input_schema) return tool;
    changed = true;
    return { ...tool, ...(description !== tool.description && { description }),
      ...(input_schema !== tool.input_schema && { input_schema }) };
  });
  return changed ? result : tools;
}

function normalizeIdentityText(text) {
  return text.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/[‘’ʼ]/g, "'").replace(/[*_`~]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function assemblyConfig(snapshot) {
  const cfg = snapshot && typeof snapshot === 'object' ? snapshot : {};
  if (assemblyConfigs.has(cfg)) return assemblyConfigs.get(cfg);
  const customPrompt = typeof cfg.customPrompt === 'string' ? cfg.customPrompt.trim() : '';
  if (!customPrompt && cfg.requireCustomPrompt) throw new Error('[clawgod] Required application rules are empty');
  const stripMemory = cfg.stripMemory === true;
  const identityMarkers = Array.isArray(cfg.identityMarkers)
    ? [...new Set(cfg.identityMarkers.filter(m => typeof m === 'string').map(normalizeIdentityText).filter(Boolean))].sort()
    : [];
  const config = { customPrompt, stripMemory, identityMarkers };
  // Only cache immutable launcher configuration; callers may still use mutable options.
  if (Object.isFrozen(cfg) && (!cfg.identityMarkers || Object.isFrozen(cfg.identityMarkers))) {
    assemblyConfigs.set(cfg, config);
  }
  return config;
}

// Only instruction sections and explicitly marked summaries enter this function.
// Match declarations at paragraph boundaries, never arbitrary mentions of a name.
function cleanPromptIdentity(text, options) {
  const cfg = assemblyConfig(options);
  if (!cfg.customPrompt || typeof text !== 'string' || text === cfg.customPrompt) return text;
  let fence, paragraph = true;
  return text.split(/(\r?\n)/).map(line => {
    if (/^\r?\n$/.test(line)) return line;
    const syntax = line.normalize('NFKC').replace(/\p{Cf}/gu, '');
    const delimiter = syntax.match(/^ {0,3}(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length) fence = undefined;
      paragraph = false;
      return line;
    }
    if (!syntax.trim()) { paragraph = true; return line; }
    if (fence || /^(?: {4}|\t)|^\s*(?:>|["'“‘«「『`])/.test(syntax)) { paragraph = false; return line; }
    if (/^ {0,3}#{1,6}\s|^(?:Summary:|<\/?summary>)\s*$/.test(syntax)) { paragraph = true; return line; }
    const atStart = paragraph;
    paragraph = false;
    if (!atStart) return line;
    const normalized = normalizeIdentityText(line);
    let declaration, replacement = '', subject = 'You are';
    const host = normalized.match(/^(you are|i am) (?:(a|an) ([^.!?\n]{1,120}?) (for|in) )?(?:claude code(?:y)?|clawgody)(?=$|[\s\p{P}])/u);
    const sdk = normalized.match(/^(you are|i am) a (?:claude|clawgody) agent(?=$|[\s\p{P}])/u);
    const chinese = normalized.match(/^(你是|我是)\s*(?:claude code(?:y)?|clawgody)(?=$|[\s\p{P}])/u);
    if (host) {
      const suffix = normalized.slice(host[0].length);
      if (/^['’]s\b|^\s+(?!and\b|who\b)\p{L}/u.test(suffix) ||
          host[4] === 'in' && /\b(?:expert|specialist)\b/.test(host[3])) return line;
      declaration = host[0];
      subject = host[1] === 'i am' ? 'I am' : 'You are';
      if (host[2]) replacement = subject + ' ' + host[2] + ' ' + host[3];
    } else if (sdk) {
      declaration = sdk[0];
      replacement = (sdk[1] === 'i am' ? 'I am' : 'You are') + ' an agent';
    } else if (chinese) {
      declaration = chinese[0];
    } else {
      declaration = cfg.identityMarkers.find(marker => normalized === marker || normalized.startsWith(marker) &&
        /^[\s\p{P}]/u.test(normalized.slice(marker.length)));
    }
    if (!declaration) return line;
    // Map only the short matched prefix back to its original spelling. The rest
    // (including duties, Unicode, and technical references) stays byte-for-byte.
    let end = 0;
    for (const character of line) {
      end += character.length;
      const prefix = normalizeIdentityText(line.slice(0, end));
      if (prefix === declaration) break;
      if (prefix.length > declaration.length) return line;
    }
    let tail = line.slice(end).replace(/^[*_~]+/, '');
    if (host) tail = tail.replace(/^, Anthropic['’]s official CLI for Claude(?:, running within the Claude Agent SDK)?(?=\.)/, '');
    if (!replacement) {
      // Drop a standalone name, retaining any role or duty in the same sentence.
      if (/^,\s*(?:a|an|the)\s+/i.test(tail)) tail = subject + ' ' + tail.replace(/^,\s*/, '');
      else if (/^\s+(?:and|who)\s+/i.test(tail)) tail = (subject === 'I am' ? 'I ' : 'You ') + tail.replace(/^\s+(?:and|who)\s+/i, '');
      else tail = tail.replace(/^[ \t,.!?。！？、，；;:：]+/u, '');
    }
    return line.match(/^ */)[0] + replacement + tail;
  }).join('');
}

function prepareIdentityTemplate(text, kind, options) {
  const cfg = assemblyConfig(options);
  if (!cfg.customPrompt || text === cfg.customPrompt) return text;
  let cleaned = cleanApplicationContext(text, options);
  if (!['summary', 'memory'].includes(kind)) return cleaned;
  const legacy = 'The continuing application is ClawGod_Y. Preserve task facts, technical names, and user quotations. ' +
    'Do not promote historical assistant self-identifications into application rules for the continuing session.';
  const note = legacy + ' Current application identity comes only from the active system configuration. ' +
    'Do not store historical application identity declarations as current identity or instructions; retain task facts and quoted history.';
  // Remove only notes generated by older clients. Do not add another identity
  // or behavioral policy alongside the opaque application rules.
  cleaned = cleaned.replaceAll(note, '').replaceAll(legacy, '');
  if (kind === 'summary') cleaned = cleaned
    .replace(/^Summarize this portion of a (?:Claude Code(?:_Y)?|ClawGod_Y) session transcript\./,
      'Summarize this portion of a session transcript.')
    .replace('What ClawGod_Y did', 'What the assistant did')
    .replace('What Claude did', 'What the assistant did');
  return cleaned;
}

function cleanSummaryContent(value, options) {
  if (!value || typeof value !== 'object') throw new Error('[clawgod] Unsupported compact summary content');
  if (value.isCompactSummary === true && value.message && typeof value.message === 'object') {
    const message = cleanSummaryContent(value.message, options);
    return message === value.message ? value : { ...value, message };
  }
  const content = value.content;
  let next = content;
  if (typeof content === 'string') next = cleanPromptIdentity(content, options);
  else if (Array.isArray(content)) {
    let changed = false;
    const blocks = content.flatMap(block => {
      if (block?.type !== 'text' || typeof block.text !== 'string') return [block];
      const text = cleanPromptIdentity(block.text, options);
      if (text === block.text) return [block];
      changed = true;
      return text.trim() ? [{ ...block, text }] : [];
    });
    if (changed) next = blocks;
  }
  return next === content ? value : { ...value, content: next };
}

function cleanSummaryMessages(messages, options) {
  if (!Array.isArray(messages)) throw new Error('[clawgod] Unsupported conversation for summary isolation');
  let changed = false;
  const result = messages.flatMap(record => {
    if (record?.type !== 'user' || record.isCompactSummary !== true || !record.message) return [record];
    const message = cleanSummaryContent(record.message, options);
    if (typeof message.content === 'string' && !message.content.trim() || Array.isArray(message.content) && !message.content.length) {
      changed = true;
      return [];
    }
    if (message === record.message) return [record];
    changed = true;
    return [{ ...record, message }];
  });
  return changed ? result : messages;
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
  return sections.flatMap(section => {
    if (!section || typeof section.id !== 'string') {
      throw new Error('[clawgod] Default prompt section is missing its source ID');
    }
    const id = section.id.split(':', 1)[0];
    if (id === 'lean_body') throw new Error('[clawgod] Host prompt sections were not separated');
    if (DEFAULT_BEHAVIOR_SECTIONS.has(id)) return [];
    if (cfg.stripMemory && (id === 'memory' || id === 'memory_static')) return [];
    const text = cleanApplicationContext(section.text, options);
    if (text !== section.text && !text.trim()) return [];
    return [text === section.text ? section : { ...section, text }];
  });
}

function applicationRules(options) {
  const cfg = assemblyConfig(options);
  if (!cfg.customPrompt) return '';
  if (cfg.rules) return cfg.rules;
  // Keep the file opaque. Scope its authority inside the same owned frame so
  // resumed/coalesced prompts cannot duplicate or retain an old precedence note.
  const body = 'The application rules below are the highest-priority application instructions for identity and general behavior. ' +
    'Other system sections supply task context and tool operation details; conflicting general guidance in those sections does not override these rules. ' +
    'Actual tool permissions, availability, and protocol requirements remain applicable.\n\n' + cfg.customPrompt;
  return cfg.rules ??= CUSTOM_PROMPT_PREFIX + '<!-- clawgod:assembly-policy ' +
    JSON.stringify([IDENTITY_POLICY_VERSION, cfg.stripMemory, cfg.identityMarkers, body.length]) + ' -->\n' +
    body + CUSTOM_PROMPT_END;
}

// Strip only framed application sections at section boundaries. Both assembly and
// transport use this parser so coalesced runtime context survives repeated assembly.
function splitApplicationSections(text, rules, customPrompt) {
  if (text === customPrompt) return { text: '', owned: 1, current: 0, unframed: false };
  const parts = [];
  let cursor = 0, search = 0, owned = 0, current = 0, unframed = false, start;
  while ((start = text.indexOf(CUSTOM_PROMPT_PREFIX, search)) >= 0) {
    search = start + CUSTOM_PROMPT_PREFIX.length;
    if (start > 0 && text.slice(start - 2, start) !== '\n\n' && text.slice(start - 4, start) !== '\r\n\r\n') continue;
    // A quoted marker/header alone does not establish ownership. Recognize the
    // legacy client wrapper solely for migration; never reproduce its rules.
    let managed = text.startsWith(LEGACY_PROMPT_HEADER, search), frameEnd;
    if (!managed) {
      const lineEnd = text.indexOf('\n', search);
      const metadata = lineEnd < 0 ? undefined : text.slice(search, lineEnd).match(/^<!-- clawgod:assembly-policy (\[.*\]) -->\r?$/);
      if (metadata) try {
        const policy = JSON.parse(metadata[1]);
        managed = Array.isArray(policy) && [3, 4].includes(policy.length) && Number.isInteger(policy[0]) && policy[0] >= 3 &&
          typeof policy[1] === 'boolean' && Array.isArray(policy[2]) && policy[2].every(marker => typeof marker === 'string');
        if (managed && policy.length === 4) {
          managed = Number.isSafeInteger(policy[3]) && policy[3] >= 0;
          if (managed) {
            // Skip the opaque body by length, including any literal marker examples.
            const boundary = lineEnd + 1 + policy[3];
            frameEnd = text.startsWith(CUSTOM_PROMPT_END, boundary) ? boundary : -1;
          }
        }
      } catch {}
    }
    if (!managed) continue;
    const exact = text.startsWith(rules, start);
    const end = exact ? start + rules.length : frameEnd ?? text.indexOf(CUSTOM_PROMPT_END, search);
    if (end < 0) { unframed = true; continue; }
    owned++;
    if (exact) current++;
    parts.push(text.slice(cursor, start));
    cursor = exact ? end : end + CUSTOM_PROMPT_END.length;
    if (text.startsWith('\r\n\r\n', cursor)) cursor += 4;
    else if (text.startsWith('\n\n', cursor)) cursor += 2;
    search = cursor;
  }
  return { text: cursor === 0 ? text : parts.join('') + text.slice(cursor), owned, current, unframed };
}

function rewritePromptAssembly(sections, options) {
  if (!Array.isArray(sections)) {
    if (options?.requireCustomPrompt) {
      throw new Error('[clawgod] Required application prompt injection failed: unsupported assembly result');
    }
    return sections;
  }
  const { customPrompt } = assemblyConfig(options);
  const rules = applicationRules(options);
  if (!rules) return sections;
  let owned = 0, unframed = false, changed = false;
  const retained = sections.flatMap(section => {
    if (typeof section !== 'string') return [section];
    const split = splitApplicationSections(section, rules, customPrompt);
    owned += split.owned;
    unframed ||= split.unframed;
    const text = cleanApplicationContext(split.text, options);
    changed ||= text !== split.text;
    return (split.owned || text !== split.text) && !text.trim() ? [] : [text];
  });
  if (sections[0] === rules && owned === 1 && !unframed && !changed) return sections;
  return [rules, ...retained];
}

// Runs on the SDK's completed request options, after caller overrides and before transport.
function finalizeSystemRequest(request, options) {
  const rules = applicationRules(options);
  if (!rules) return request;
  const raw = request?.body;
  const serialized = typeof raw === 'string' || ArrayBuffer.isView(raw);
  let body = serialized ? JSON.parse(typeof raw === 'string' ? raw :
    Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('utf8')) : raw;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('[clawgod] Unsupported Messages request body');
  }
  const tools = brandToolDefinitions(body.tools);
  // A continue request inherits the system prefix from its create request on the server.
  // Re-inserting it into a delta would change the inherited prefix and defeat thread caching.
  if (body.thread !== undefined) {
    if (!body.thread || !['create', 'continue', 'continue_no_save'].includes(body.thread.type)) {
      throw new Error('[clawgod] Unsupported Messages thread type');
    }
    if (body.thread.type !== 'create') return tools === body.tools ? request : {
      ...request, body: serialized ? JSON.stringify({ ...body, tools }) : { ...body, tools },
    };
  }
  const system = body.system;
  const blocks = typeof system === 'string' ? [{ type: 'text', text: system }] : system ?? [];
  if (!Array.isArray(blocks) || blocks.some(block => block?.type !== 'text' || typeof block.text !== 'string')) {
    throw new Error('[clawgod] Unsupported system prompt blocks');
  }
  // Assemblers may coalesce sections into a cacheable block. Keep its bytes and cache
  // metadata unchanged when it already contains exactly one current application section.
  const { customPrompt } = assemblyConfig(options);
  let owned = 0, current = 0, ruleBlock, changed = false;
  const retained = blocks.flatMap(block => {
    const split = splitApplicationSections(block.text, rules, customPrompt);
    if (split.unframed) throw new Error('[clawgod] Stale unframed application prompt; rebuild the prompt snapshot');
    owned += split.owned;
    current += split.current;
    const text = cleanApplicationContext(split.text, options);
    changed ||= text !== split.text;
    if (!split.owned) return text === block.text ? [block] : text.trim() ? [{ ...block, text }] : [];
    if (text.trim()) return [{ ...block, text }];
    if (!ruleBlock || !ruleBlock.cache_control && block.cache_control) ruleBlock = block;
    return [];
  });
  if (owned === 1 && current === 1 && !changed && tools === body.tools) return request;
  body = { ...body, ...(tools !== body.tools && { tools }),
    system: owned === 1 && current === 1 && !changed ? system : [{ ...ruleBlock, type: 'text', text: rules }, ...retained] };
  return { ...request, body: serialized ? JSON.stringify(body) : body };
}

function refreshPromptSnapshot(result, currentPrompt, options, hashPrompt, createRecord) {
  const rules = applicationRules(options);
  if (!rules) return result;
  if (!Array.isArray(result?.systemPrompt)) throw new Error('[clawgod] Unsupported prompt snapshot');
  if (rewritePromptAssembly(result.systemPrompt, options) === result.systemPrompt) return result;
  // Rebuild stale snapshots from filtered live sections, so old host identity/workflow
  // cannot survive a rule update. Keep upstream tool and wire metadata in the record.
  const prompt = rewritePromptAssembly(currentPrompt, options);
  if (prompt.length === result.systemPrompt.length &&
      prompt.every((section, index) => section === result.systemPrompt[index])) return result;
  return {
    ...result,
    systemPrompt: prompt,
    record: createRecord(prompt, result.record?.attachment),
    snapshotHash: hashPrompt(prompt),
    source: 'live_recorded',
    atRenderPoint: true,
    rewritten: true,
  };
}

function validateExtraBody(body) {
  const reserved = ['system', 'messages', 'thread'].filter(name => Object.hasOwn(body, name));
  if (reserved.length) {
    throw new Error('[clawgod] CLAUDE_CODE_EXTRA_BODY cannot override ' + reserved.join(', ') +
      '. Remove these fields; system instructions, conversation messages and threads are managed by ClawGod_Y.');
  }
  return body;
}

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
