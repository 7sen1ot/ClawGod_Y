
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rewritePromptAssembly, selectApplicationPrompt, filterDefaultPromptSections } from './runtime-helpers.cjs';

const MARK = '<!-- clawgod:custom-prompt -->';
const opts = prompt => ({ customPrompt: prompt, stripMemory: true });

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
  assert.ok(out[0].startsWith(MARK + '\n# Application identity\n'));
  assert.match(out[0], /The application name is ClawGod_Y\./);
  assert.ok(out[0].includes('# Application rules\n' + prompt));
  assert.match(out[0], /# Supporting runtime and task context/);
  assert.deepEqual(out.slice(1), kept.map(section => section.text));
  assert.deepEqual(filterDefaultPromptSections(sections, { ...opts(prompt), stripMemory: false }), sections.slice(3));
}
{
  const prompt = 'ALPHA block one.\n\nBRAVO block two.';
  const out = rewritePromptAssembly([prompt, MARK + '\nOutdated rules.'], opts(prompt));
  assert.equal(out.length, 1);
  assert.ok(out[0].startsWith(MARK));
  assert.ok(out[0].includes('# Application rules\n' + prompt));
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
  assert.deepEqual(twice, once);
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
  const real = readFileSync(new URL('./system-prompt.md', import.meta.url), 'utf8').trim();
  assert.ok(real.length > 0);
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
  assert.deepEqual(customOut, [sections[1]]);
}

console.log('[prompt-assembly.test] source sections, application identity, context preservation, required rules and idempotence ok');
