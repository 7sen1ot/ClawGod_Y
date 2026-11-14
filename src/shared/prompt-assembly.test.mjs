
import assert from 'node:assert/strict';
import { rewritePromptAssembly, selectApplicationPrompt, filterDefaultPromptSections, refreshPromptSnapshot, finalizeSystemRequest,
  cleanPromptIdentity, cleanSummaryContent, cleanSummaryMessages, prepareIdentityTemplate, validateExtraBody, brandApplicationText } from './runtime-helpers.cjs';

const MARK = '<!-- clawgod:custom-prompt -->';
const END = '\n<!-- /clawgod:custom-prompt -->';
const opts = prompt => ({ customPrompt: prompt, stripMemory: true });
const legacyFrame = prompt => MARK + '\n# Application identity\nThe application name is ClawGod_Y. ' +
  'Use this name for application self-identification.\n\n# Application rules\n' + prompt +
  '\n\n# Supporting runtime and task context\nPreserve tool protocols.\n<!-- clawgod:assembly-policy [2,false,[]] -->' + END;

{
  const prompt = 'Custom application rules.';
  const sections = [
    { id: 'intro', text: 'You are Claude Code, an interactive CLI tool.' },
    { id: 'tone:shared', text: 'Host style.' },
    { id: 'doing_tasks', text: 'Host workflow.' },
    { id: 'tools', text: 'Tool protocol.' },
    { id: 'runtime', text: 'Your working directory is /x.' },
    { id: 'specialist', text: 'Review the specified changes.' },
    { id: 'memory', text: 'Session memory.' },
    { id: 'memory_static:shared', text: 'Static memory.' },
  ];
  const kept = filterDefaultPromptSections(sections, opts(prompt));
  assert.deepEqual(kept, sections.slice(3, 6));
  const out = selectApplicationPrompt(kept.map(section => section.text), opts(prompt));
  assert.ok(out[0].startsWith(MARK + '\n<!-- clawgod:assembly-policy [10,'));
  assert.ok(out[0].endsWith('\n\n' + prompt + END));
  assert.ok(!out[0].includes('ClawGod_Y'));
  assert.deepEqual(out.slice(1), kept.map(section => section.text));
  assert.deepEqual(filterDefaultPromptSections(sections, { ...opts(prompt), stripMemory: false }), sections.slice(3));
}
{
  const prompt = 'ALPHA block one.\n\nBRAVO block two.';
  const stale = rewritePromptAssembly([], opts('Outdated rules.'))[0];
  const out = rewritePromptAssembly([prompt, stale], opts(prompt));
  assert.equal(out.length, 1);
  assert.ok(out[0].startsWith(MARK));
  assert.ok(out[0].includes('\n' + prompt + END));
  assert.ok(!out[0].includes('Outdated rules.'));
}
{
  const prompt = 'Line one of the role.\nSecond line of the role.';
  const variant = 'Line one   of the role.\n   Second line of the role.';
  const context = 'Quoted task context.\n' + variant;
  const out = rewritePromptAssembly([context], opts(prompt));
  assert.equal(out[1], context, 'Unmarked task context must not be scrubbed by text similarity');
}

{
  const options = opts('Custom role.');
  assert.throws(() => filterDefaultPromptSections('not-an-array', options), /Unsupported default prompt sections/);
  assert.throws(() => filterDefaultPromptSections([{ text: 'Missing source.' }], options), /missing its source ID/);
  assert.throws(() => filterDefaultPromptSections([{ id: 'lean_body', text: 'Combined.' }], options), /not separated/);
}

{
  const prompt = 'Custom role.';
  const once = rewritePromptAssembly(
    ['Runtime context.'],
    opts(prompt));
  const twice = rewritePromptAssembly(once, opts(prompt));
  assert.equal(twice, once, 'unchanged assembly reuses its array');
}

{
  const options = opts('Fixture rules.');
  const rules = rewritePromptAssembly([], options)[0];
  const stale = rewritePromptAssembly([], opts('Older fixture rules.'))[0];
  for (const separator of ['\n\n', '\r\n\r\n']) {
    const combined = rewritePromptAssembly([rules + separator + 'Keep tool protocol.'], options);
    assert.deepEqual(combined, [rules, 'Keep tool protocol.']);
    assert.equal(rewritePromptAssembly(combined, options), combined);
    const embedded = rewritePromptAssembly(['Runtime facts.' + separator + stale + separator + rules + separator + 'Specialist duty.'], options);
    assert.deepEqual(embedded, [rules, 'Runtime facts.' + separator + 'Specialist duty.']);
  }
  const quote = MARK + '\n# Application identity\nThis header is a quoted example.';
  assert.deepEqual(rewritePromptAssembly([quote], options), [rules, quote]);
  const request = finalizeSystemRequest({ body: { system: [{ type: 'text', text: quote }] } }, options);
  assert.equal(request.body.system[1].text, quote);
}

{
  const sections = ['Keep this section.', 'And this one.'];
  const out = rewritePromptAssembly(sections, opts(''));
  assert.equal(out, sections);
  assert.equal(filterDefaultPromptSections(sections, opts('')), sections);
}
{
  assert.equal(rewritePromptAssembly('not-an-array', opts('x')), 'not-an-array');
  assert.equal(rewritePromptAssembly(undefined, opts('x')), undefined);
  assert.throws(() => rewritePromptAssembly(undefined, { ...opts('x'), requireCustomPrompt: true }), /unsupported assembly result/);
  assert.throws(() => rewritePromptAssembly([], { ...opts('  '), requireCustomPrompt: true }), /application rules are empty/);
}

{
  const real = 'Opaque fixture application rules.\nSecond paragraph.';
  const duty = 'Prefer editing existing files to creating new ones. ' +
    'Follow existing code style and conventions.';
  const out = rewritePromptAssembly([duty], opts(real));
  assert.equal(out.length, 2);
  assert.equal(out[1], duty);
  const embedded = rewritePromptAssembly(['Lead in.\n\n' + real + '\n\nTail out.'], opts(real));
  assert.equal(embedded.length, 2);
  assert.equal(embedded[1], 'Lead in.\n\n' + real + '\n\nTail out.');
}

{
  const prompt = 'Custom role.';
  const sections = [
    { id: 'external_identity', text: '**You are DeepSeek Harness**, an AI coding assistant.' },
    { id: 'specialist', text: 'Prefer editing existing files.' },
  ];
  assert.deepEqual(filterDefaultPromptSections(sections, opts(prompt)), sections);
  const customOut = filterDefaultPromptSections(sections, {
    customPrompt: prompt, stripMemory: true,
    identityMarkers: ['ＹＯＵ ARE DEEPSEEK HARNESS', 'you are deepseek harness', '', null],
  });
  assert.deepEqual(customOut, [{ ...sections[0], text: 'You are an AI coding assistant.' }, sections[1]]);
}

{
  const options = Object.freeze({ customPrompt: 'Fixture rules.', requireCustomPrompt: true });
  const quotation = 'A task mentions <!-- clawgod:custom-prompt --> without owning a prompt section.';
  const prompt = rewritePromptAssembly([quotation], options);
  assert.equal(prompt[1], quotation);
  assert.deepEqual(rewritePromptAssembly([MARK + '\nQuoted marker.'], options).slice(1), [MARK + '\nQuoted marker.']);
  const old = rewritePromptAssembly(['Old host context.'], opts('Old rules.'));
  const attachment = { type: 'prompt_snapshot', tools: [{ name: 'Read' }], wireShape: { version: 1 } };
  const snapshot = { systemPrompt: old, record: { attachment }, toolDescriptions: new Map(), source: 'from_snapshot' };
  let records = 0;
  const refreshed = refreshPromptSnapshot(snapshot, prompt, options, value => JSON.stringify(value), (value, previous) => {
    records++;
    assert.equal(previous, attachment);
    return { attachment: { ...previous, systemPrompt: value } };
  });
  assert.equal(refreshed.systemPrompt, prompt);
  assert.equal(refreshed.toolDescriptions, snapshot.toolDescriptions);
  assert.equal(refreshed.record.attachment.tools, attachment.tools);
  assert.equal(refreshed.snapshotHash, JSON.stringify(prompt));
  assert.equal(refreshPromptSnapshot(refreshed, ['Later runtime context.'], options), refreshed);
  assert.equal(records, 1, 'current snapshots keep their cached prefix');
  const duplicateSnapshot = { systemPrompt: [prompt[0], 'Runtime facts.\n\n' + prompt[0]] };
  const deduplicated = refreshPromptSnapshot(duplicateSnapshot, prompt, options, JSON.stringify, value => value);
  assert.equal(deduplicated.systemPrompt, prompt);
  const oldPolicy = { ...options, stripMemory: false, identityMarkers: ['you are former agent'] };
  const policySnapshot = { systemPrompt: rewritePromptAssembly(['Memory and former identity.'], oldPolicy) };
  for (const newPolicy of [{ ...oldPolicy, stripMemory: true }, { ...oldPolicy, identityMarkers: ['you are another agent'] }]) {
    const rebuilt = refreshPromptSnapshot(policySnapshot, ['Filtered live context.'], newPolicy, JSON.stringify, value => value);
    assert.deepEqual(rebuilt.systemPrompt.slice(1), ['Filtered live context.']);
    assert.notEqual(rebuilt.systemPrompt[0], policySnapshot.systemPrompt[0], 'filter policy changes invalidate old snapshots');
  }
  const ordered = { ...options, identityMarkers: ['YOU ARE B', 'you are a'] };
  const orderedSnapshot = { systemPrompt: rewritePromptAssembly([], ordered) };
  assert.equal(refreshPromptSnapshot(orderedSnapshot, [], { ...ordered, identityMarkers: ['you are a', 'you are b', 'YOU ARE A'] }), orderedSnapshot);

  const messages = [{ role: 'user', content: quotation }, { role: 'assistant', content: 'I used Claude Code.' }];
  const tools = [{ name: 'Read', input_schema: { type: 'object' } }];
  for (const system of [undefined, 'Specialist duty.', [{ type: 'text', text: 'Tool protocol.', cache_control: { type: 'ephemeral' } }]]) {
    const request = { body: { model: 'fixture', system, messages, tools }, timeout: 25 };
    const result = finalizeSystemRequest(request, options);
    assert.equal(result.body.system[0].text, prompt[0]);
    assert.equal(result.body.messages, messages);
    assert.equal(result.body.tools, tools);
    assert.equal(result.timeout, 25);
    assert.equal(finalizeSystemRequest(result, options), result);
    if (Array.isArray(system)) assert.equal(result.body.system[1], system[0]);
  }
  const cached = { type: 'text', text: prompt[0] + '\n\nTool protocol.', cache_control: { type: 'ephemeral' } };
  const current = { body: { system: [cached], messages } };
  assert.equal(finalizeSystemRequest(current, options), current);
  const repeated = finalizeSystemRequest({ body: { system: [cached, { type: 'text', text: prompt[0] }], messages } }, options);
  assert.equal(repeated.body.system.length, 2);
  assert.equal(repeated.body.system[1].text, 'Tool protocol.');
  assert.equal(repeated.body.system[1].cache_control, cached.cache_control);
  const coalesced = { body: { system: [{ ...cached, text: 'Runtime prefix.\n\n' + cached.text }], messages } };
  assert.equal(finalizeSystemRequest(coalesced, options), coalesced);
  const doubled = finalizeSystemRequest({ body: { system: [{ ...cached, text: prompt[0] + '\n\n' + cached.text }], messages } }, options);
  assert.deepEqual(doubled.body.system, [{ type: 'text', text: prompt[0] }, { ...cached, text: 'Tool protocol.' }]);
  const cachedRules = { type: 'text', text: prompt[0], cache_control: { type: 'ephemeral', ttl: '1h' } };
  const cachedDuplicate = finalizeSystemRequest({ body: { system: [cachedRules, cachedRules], messages } }, options);
  assert.deepEqual(cachedDuplicate.body.system, [cachedRules]);
  const rawDuplicate = finalizeSystemRequest({ body: { system: [{ type: 'text', text: options.customPrompt }, cachedRules], messages } }, options);
  assert.deepEqual(rawDuplicate.body.system, [cachedRules]);
  for (const encode of [JSON.stringify, value => Buffer.from(JSON.stringify(value))]) {
    const encoded = { body: encode(current.body) };
    assert.equal(finalizeSystemRequest(encoded, options), encoded, 'valid serialized body stays byte-for-byte unchanged');
    const missing = finalizeSystemRequest({ body: encode({ messages }) }, options);
    assert.equal(JSON.parse(missing.body).system[0].text, prompt[0]);
  }
  for (const type of ['continue', 'continue_no_save']) {
    const delta = { body: { thread: { type, previous_message_id: 'fixture' }, messages } };
    assert.equal(finalizeSystemRequest(delta, options), delta, 'server continuation inherits the original system prefix');
    const serialized = { body: JSON.stringify(delta.body) };
    assert.equal(finalizeSystemRequest(serialized, options), serialized);
  }
  for (const thread of [null, {}, { type: 'unknown' }]) {
    assert.throws(() => finalizeSystemRequest({ body: { thread, messages } }, options), /Unsupported Messages thread type/);
  }
  assert.throws(() => validateExtraBody({ thread: { type: 'continue' } }), /cannot override thread/);
  assert.throws(() => finalizeSystemRequest({ body: { system: [{ type: 'image' }] } }, options), /Unsupported system prompt/);
  assert.throws(() => finalizeSystemRequest({ body: null }, options), /Unsupported Messages request/);
  assert.throws(() => finalizeSystemRequest(current, { requireCustomPrompt: true }), /rules are empty/);
}

{
  const options = { ...opts('Fixture rules.'), identityMarkers: ['you are deepseek harness'] };
  const quoted = { id: 'tools', text: 'Keep the example "You are DeepSeek Harness" unchanged.' };
  const different = { id: 'specialist', text: 'You are DeepSeek HarnessTester.' };
  const duties = { id: 'specialist', text: '**You are DeepSeek Harness**, an assistant.\n\nReview the files.\nPreserve tool protocols.', scope: 'shared' };
  assert.deepEqual(filterDefaultPromptSections([quoted, different, duties], options), [quoted, different,
    { ...duties, text: 'You are an assistant.\n\nReview the files.\nPreserve tool protocols.' }]);
  for (const [text, expected] of [
    ['**You are DeepSeek Harness**, an assistant. Review the files.\nPreserve tool protocols.', 'You are an assistant. Review the files.\nPreserve tool protocols.'],
    ['You are DeepSeek Harness\nReview the files.\nPreserve tool protocols.', '\nReview the files.\nPreserve tool protocols.'],
    ['You are DeepSeek Harness。 Review the files.\nPreserve tool protocols.', 'Review the files.\nPreserve tool protocols.'],
  ]) {
    assert.deepEqual(filterDefaultPromptSections([{ ...duties, text }], options),
      [{ ...duties, text: expected }]);
  }
  assert.deepEqual(filterDefaultPromptSections([{ id: 'specialist', text: 'You are Dr. Legacy Agent. Keep tool protocols.' }],
    { ...options, identityMarkers: ['you are dr. legacy agent'] }), [{ id: 'specialist', text: 'Keep tool protocols.' }]);
}

{
  const options = Object.freeze({ customPrompt: 'Independent identity fixture.', requireCustomPrompt: true });
  const known = 'You are Claude Code, Anthropic\'s official CLI for Claude. Review files with the Claude Code SDK.';
  const cleaned = 'Review files with the Claude Code SDK.';
  const branded = 'Review files with the ClawGod_Y SDK.';
  assert.equal(cleanPromptIdentity(known, options), cleaned);
  assert.equal(cleanPromptIdentity('Ｙｏｕ are Clau\u200bde Code. Keep facts.', options), 'Keep facts.');
  assert.equal(cleanPromptIdentity('你是 Claude Code。 保留职责。', options), '保留职责。');
  assert.equal(cleanPromptIdentity('You are ClawGod_Y. Keep facts.', options), 'Keep facts.');
  assert.equal(cleanPromptIdentity('You are Claude Code and must preserve tool protocols.', options), 'You must preserve tool protocols.');
  assert.equal(cleanPromptIdentity('You are a Claude agent, built on Anthropic\'s Claude Agent SDK.', options), 'You are an agent, built on Anthropic\'s Claude Agent SDK.');
  const protectedText = '> You are Claude Code.\n\n```text\nYou are Claude Code.\n```\n\n' +
    '"You are Claude Code" is a quotation.\n\nThe assistant said it was Claude Code.\n\n' +
    '    You are Claude Code.\n\nYou are using the Claude Code SDK.\n\nThe configured model is glm-5.3-flash.';
  assert.equal(cleanPromptIdentity(protectedText, options), protectedText);
  const invisibleQuote = '\u200b`You are Claude Code`\n\n\u200b```text\n\nYou are Claude Code.\n```';
  assert.equal(cleanPromptIdentity(invisibleQuote, options), invisibleQuote);
  for (const reference of ["You are a specialist in Claude Code.", "You are a reviewer for Claude Code's SDK.", "You are Claude Code SDK support."]) {
    assert.equal(cleanPromptIdentity(reference, options), reference);
  }
  const memory = [{ id: 'memory', text: known + '\n\nTask fact: keep port 8080.' },
    { id: 'memory_static:shared', text: 'User prefers Chinese.' }];
  assert.deepEqual(filterDefaultPromptSections(memory, options), [
    { ...memory[0], text: branded + '\n\nTask fact: keep port 8080.' }, memory[1]]);
  assert.deepEqual(filterDefaultPromptSections(memory, { ...options, stripMemory: true }), []);
  const assembled = rewritePromptAssembly([known, 'You are a reviewer for Claude Code. Review only.'], options);
  assert.equal(assembled[1], branded);
  assert.equal(assembled[2], 'You are a reviewer. Review only.');
  assert.equal(rewritePromptAssembly(assembled, options), assembled);
  const raw = { content: 'Summary:\nI am Claude Code.\n\nTask fact: keep port 8080.', isCompactSummary: true };
  const summary = cleanSummaryContent(raw, options);
  assert.ok(!summary.content.includes('I am'));
  assert.match(summary.content, /Task fact: keep port 8080/);
  assert.match(raw.content, /I am Claude Code/);
  const ordinary = { type: 'user', message: { content: known } };
  const tools = { type: 'user', message: { content: [{ type: 'tool_result', content: known, tool_use_id: 'read' }] } };
  const record = { type: 'user', isCompactSummary: true, uuid: 'retained', message: { role: 'user', content: raw.content } };
  const original = [ordinary, tools, record];
  const view = cleanSummaryMessages(original, options);
  assert.equal(view[0], ordinary);
  assert.equal(view[1], tools);
  assert.equal(view[2].uuid, record.uuid);
  assert.equal(view[2].message.content, summary.content);
  assert.equal(original[2], record);
  assert.equal(cleanSummaryMessages(view, options), view);
  const template = 'Your task is to create a detailed summary of this conversation.\nKeep facts.';
  const prepared = prepareIdentityTemplate(template, 'summary', options);
  assert.equal(prepareIdentityTemplate(prepared, 'summary', options), prepared);
  assert.equal(prepared, template, 'summary tasks must not receive an extra application policy');
  const current = rewritePromptAssembly([], options);
  const old = { systemPrompt: [legacyFrame(options.customPrompt)] };
  assert.notEqual(refreshPromptSnapshot(old, ['New task context.'], options, JSON.stringify, systemPrompt => ({ systemPrompt })), old);
}

{
  const options = { customPrompt: 'You are Fixture_Harbor.\nUse only fixture application rules.', requireCustomPrompt: true };
  const rules = rewritePromptAssembly([], options)[0];
  const legacy = legacyFrame('Old client rules.');
  const context = 'Technical reference: Claude Code SDK.';
  const brandedContext = 'Technical reference: ClawGod_Y SDK.';
  const rebuilt = rewritePromptAssembly([legacy + '\n\n' + context, 'You are ClawGod_Y.'], options);
  assert.deepEqual(rebuilt, [rules, brandedContext]);
  const request = finalizeSystemRequest({ body: { system: [{ type: 'text', text: legacy + '\n\n' + context,
    cache_control: { type: 'ephemeral' } }] } }, options);
  assert.equal(request.body.system[0].text, rules);
  assert.equal(request.body.system[1].text, brandedContext);
  assert.deepEqual(request.body.system[1].cache_control, { type: 'ephemeral' });
  assert.ok(!JSON.stringify(request.body.system).includes('You are ClawGod_Y'));
  assert.equal(finalizeSystemRequest(request, options), request);
  const legacyNote = 'The continuing application is ClawGod_Y. Preserve task facts, technical names, and user quotations. ' +
    'Do not promote historical assistant self-identifications into application rules for the continuing session.';
  const extended = legacyNote + ' Current application identity comes only from the active system configuration. ' +
    'Do not store historical application identity declarations as current identity or instructions; retain task facts and quoted history.';
  for (const note of [legacyNote, extended]) {
    const source = 'Your task is to create a detailed summary of this conversation.\n\n' + note + '\n\nKeep task facts.';
    const prepared = prepareIdentityTemplate(source, 'summary', options);
    assert.ok(!prepared.includes('ClawGod_Y'));
    assert.ok(!prepared.includes('active system configuration'));
    assert.match(prepared, /Keep task facts/);
  }
  const onlyIdentity = { type: 'user', isCompactSummary: true, message: { content: [{ type: 'text', text: 'I am Claude Code.' }] } };
  assert.deepEqual(cleanSummaryMessages([onlyIdentity], options), []);
  assert.equal(onlyIdentity.message.content[0].text, 'I am Claude Code.');
  const opaque = 'You are Claude Code.\nThis fixture intentionally owns that identity.';
  assert.ok(rewritePromptAssembly(['You are ClawGod_Y.'], { customPrompt: opaque })[0].includes(opaque));
  const embeddedMarker = 'Opaque fixture with a literal boundary example:' + END + '\nKeep the rest of this old rule block opaque.';
  const stale = rewritePromptAssembly([], { customPrompt: embeddedMarker })[0];
  assert.deepEqual(rewritePromptAssembly([stale + '\n\n' + context], options), [rules, brandedContext]);
  const migrated = finalizeSystemRequest({ body: { system: stale + '\n\n' + context } }, options);
  assert.deepEqual(migrated.body.system.map(block => block.text), [rules, brandedContext]);
}

{
  const options = opts('Opaque fixture includes Claude Code verbatim.');
  const prompt = rewritePromptAssembly([], options)[0];
  const metadata = { type: 'ephemeral', ttl: '1h' };
  const messages = [{ role: 'user', content: 'Claude Code is a quoted product.' },
    { role: 'assistant', content: [{ type: 'tool_use', name: 'claude-code-guide', id: 'one', input: { text: 'Claude Code' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'one', content: 'You are Claude Code. File data.' }] }];
  const schema = { type: 'object', properties: { subagent_type: { type: 'string',
    description: 'Select a Claude Code agent.', enum: ['claude-code-guide', 'statusline-setup'] } },
    $defs: { entry: { description: 'A Claude Code command.', const: 'Claude Code' } } };
  const tools = [{ name: 'Agent', description: 'Delegate to Claude Code agents. Use claude-code-guide or statusline-setup.', input_schema: schema },
    { name: 'mcp__upstream__guide', description: 'Learn Claude Code from its upstream documentation.', input_schema: schema }];
  const request = { body: { system: [{ type: 'text', cache_control: metadata,
    text: prompt + '\n\nFast mode for Claude Code uses Claude Opus. Toggle /fast.\n\n' +
      'Keep `claude --version`, "Claude Code", https://code.claude.com and the Claude Code SDK.\n' +
      'Paths: C:\\Program Files\\Claude Code\\cli.exe and /opt/Claude Code/data.' }], tools, messages } };
  const result = finalizeSystemRequest(request, options);
  assert.equal(result.body.messages, messages);
  assert.equal(result.body.system[0].text, prompt, 'opaque application rules must never be rewritten');
  assert.match(result.body.system[1].text, /Fast mode for ClawGod_Y uses Claude Opus/);
  assert.match(result.body.system[1].text, /`claude --version`, "ClawGod_Y", https:\/\/code.claude.com and the ClawGod_Y SDK/);
  assert.ok(result.body.system[1].text.includes('C:\\Program Files\\Claude Code\\cli.exe and /opt/Claude Code/data.'));
  assert.equal(result.body.system[1].cache_control, metadata);
  assert.match(result.body.tools[0].description, /ClawGod_Y agents/);
  assert.equal(result.body.tools[0].name, 'Agent');
  assert.equal(result.body.tools[0].input_schema.properties.subagent_type.enum, schema.properties.subagent_type.enum);
  assert.match(result.body.tools[0].input_schema.properties.subagent_type.description, /ClawGod_Y agent/);
  assert.equal(result.body.tools[0].input_schema.$defs.entry.const, 'Claude Code');
  assert.equal(result.body.tools[1].name, 'mcp__upstream__guide');
  assert.equal(result.body.tools[1].description, 'Learn ClawGod_Y from its upstream documentation.');
  assert.equal(result.body.tools[1].input_schema.$defs.entry.const, 'Claude Code');
  assert.equal(request.body.tools, tools, 'caller objects must not be mutated');
  assert.equal(finalizeSystemRequest(result, options), result);
  for (const type of ['continue', 'continue_no_save']) {
    const delta = finalizeSystemRequest({ body: { thread: { type, previous_message_id: 'one' }, tools, messages } }, options);
    assert.equal(delta.body.system, undefined, 'never add a system prefix to a thread delta');
    assert.equal(delta.body.messages, messages);
    assert.match(delta.body.tools[0].description, /ClawGod_Y agents/);
  }
  const oldRules = prompt.replace('assembly-policy [10,', 'assembly-policy [9,');
  const saved = { systemPrompt: [oldRules, 'Fast mode for Claude Code.'] };
  const refreshed = refreshPromptSnapshot(saved, ['Fast mode for Claude Code.'], options, JSON.stringify, systemPrompt => ({ systemPrompt }));
  assert.equal(refreshed.systemPrompt[0], prompt);
  assert.equal(refreshed.systemPrompt[1], 'Fast mode for ClawGod_Y.');
}

{
  const text = 'Claude Code SDK, Claude Code API, Claude Code Desktop, Claude Code JetBrains Plugin, Claude Code for VS Code.\n' +
    '**Claude Agent SDK**: Claude Code packaged as a library.\n\n' +
    '> Product: Claude Code.\n"Claude Code" and \'Claude Code\'.';
  assert.equal(brandApplicationText(text),
    'ClawGod_Y SDK, ClawGod_Y API, ClawGod_Y Desktop, ClawGod_Y JetBrains Plugin, ClawGod_Y for VS Code.\n' +
    '**Claude Agent SDK**: ClawGod_Y packaged as a library.\n\n' +
    '> Product: ClawGod_Y.\n"ClawGod_Y" and \'ClawGod_Y\'.');
  const code = '`security find-generic-password -s "Claude Code"`\n```sh\nsecurity find-generic-password -s "Claude Code"\n```';
  assert.equal(brandApplicationText(code), code, 'executable literals are compatibility values');
}

console.log('[prompt-assembly.test] source sections, application identity, context preservation, required rules and idempotence ok');
