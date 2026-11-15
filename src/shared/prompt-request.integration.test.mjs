import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { applyAstEdits } from './ast-patches.mjs';
import { scanPentestPatches } from './pentest-patches.mjs';
import * as helpers from './runtime-helpers.cjs';
import { startProxy } from './openai-proxy.cjs';

test('system instructions survive HTTP transport, tools, streaming and snapshot rebuild', { skip: typeof Bun === 'undefined' }, async () => {
  const options = Object.freeze({ customPrompt: 'Opaque transport fixture rules.', requireCustomPrompt: true });
  const source = 'class Messages{create(body,options){return this._client.post("/v1/messages",{body,...options})}}';
  const scanned = scanPentestPatches(source)['pentest-prompt-request'];
  const Messages = runInNewContext(applyAstEdits(source, scanned.matches) + ';Messages', {
    __clawgodHelpers: helpers, __clawgodAssembly: options,
  });
  const rules = helpers.rewritePromptAssembly([], options)[0];
  let protocol, calls = 0;
  const upstream = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    async fetch(req) {
      const body = await req.json();
      calls++;
      const system = protocol === 'anthropic' ? body.system.map(block => block.text).join('\n') : body.messages[0].content;
      assert.equal(system.split(options.customPrompt).length - 1, 1);
      assert.ok(system.includes(rules));
      assert.ok(!system.includes('The application name is ClawGod_Y'));
      assert.ok(!system.includes('The continuing application is ClawGod_Y'));
      assert.ok(!system.includes('Claude Code'), 'late system additions must pass through the branding policy');
      const definition = protocol === 'anthropic' ? body.tools[0] : body.tools[0].function;
      assert.equal(definition.name, 'read_file');
      assert.equal(definition.description, 'Read files for ClawGod_Y. Keep claude-code-guide and statusline-setup identifiers.');
      const messages = protocol === 'anthropic' ? body.messages : body.messages.slice(1);
      assert.ok(!JSON.stringify(messages).includes(options.customPrompt), 'instructions must not become conversation content');
      const afterTool = messages.some(message => message.role === 'tool' || Array.isArray(message.content) &&
        message.content.some(block => block.type === 'tool_result'));
      const tool = { type: 'tool_use', id: 'call-fixture', name: 'read_file', input: { path: 'fixture.txt' } };
      if (protocol === 'anthropic') return Response.json({
        type: 'message', id: 'fixture', role: 'assistant', model: body.model,
        content: afterTool ? [{ type: 'text', text: 'done' }] : [tool],
        stop_reason: afterTool ? 'end_turn' : 'tool_use', usage: { input_tokens: 1, output_tokens: 1 },
      });
      assert.equal(body.messages[0].role, 'system');
      const delta = afterTool ? { content: 'done' } : { tool_calls: [{ index: 0, id: tool.id, type: 'function',
        function: { name: tool.name, arguments: JSON.stringify(tool.input) } }] };
      const chunks = [
        { id: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: afterTool ? 'stop' : 'tool_calls' }] },
      ];
      return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  const proxy = startProxy({ baseURL: `http://127.0.0.1:${upstream.port}/v1`, apiKey: 'fixture-key' });
  try {
    for (protocol of ['anthropic', 'openai-chat']) {
      const resource = new Messages();
      resource._client = { post(path, request) {
        const port = protocol === 'anthropic' ? upstream.port : proxy.port;
        return fetch(`http://127.0.0.1:${port}${path}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request.body),
        });
      } };
      const body = { model: 'fixture', max_tokens: 100, stream: protocol === 'openai-chat',
        system: 'Fast mode for Claude Code is toggled with /fast.',
        tools: [{ name: 'read_file', description: 'Read files for Claude Code. Keep claude-code-guide and statusline-setup identifiers.',
          input_schema: { type: 'object', properties: { path: { type: 'string' } } } }],
        messages: [{ role: 'user', content: 'Read the fixture.' }] };
      let response = await resource.create(body);
      assert.equal(response.status, 200);
      let tool;
      if (body.stream) {
        const events = (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
        tool = events.find(event => event.content_block?.type === 'tool_use').content_block;
        tool.input = JSON.parse(events.find(event => event.delta?.partial_json).delta.partial_json);
        assert.equal(events.at(-1).type, 'message_stop');
      } else tool = (await response.json()).content[0];
      body.messages.push({ role: 'assistant', content: [tool] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: tool.id, content: 'fixture contents' }] });
      const stale = helpers.rewritePromptAssembly(['Old identity.'], { customPrompt: 'Old fixture rules.' });
      const snapshot = helpers.refreshPromptSnapshot({ systemPrompt: stale }, ['Tool protocol.'], options,
        JSON.stringify, systemPrompt => ({ systemPrompt }));
      body.system = snapshot.systemPrompt.map(text => ({ type: 'text', text }));
      body.system[0].text += '\n\nClaude Code status line setting.';
      response = await resource.create(body);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /done/);
    }
    assert.equal(calls, 4);
  } finally {
    proxy.stop();
    upstream.stop(true);
  }
});

test('SDK sends thread deltas unchanged and full rules on create or stateless fallback', { skip: typeof Bun === 'undefined' }, async () => {
  const requests = [];
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    requests.push(await request.json());
    return Response.json({ id: 'fixture-response' });
  } });
  const source = 'class Messages{create(body,options){return this._client.post("/v1/messages",{body,...options})}}';
  const scope = { __clawgodHelpers: helpers, __clawgodAssembly: Object.freeze({ customPrompt: 'Thread ALPHA fixture.' }) };
  const Messages = runInNewContext(applyAstEdits(source, scanPentestPatches(source)['pentest-prompt-request'].matches) + ';Messages', scope);
  const sdk = new Messages();
  sdk._client = { post(path, request) {
    return fetch(`http://127.0.0.1:${upstream.port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: typeof request.body === 'string' ? request.body : JSON.stringify(request.body) });
  } };
  const messages = [{ role: 'user', content: 'Read the fixture.' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'read-one', name: 'Read', input: { file_path: '/fixture' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read-one', content: 'You are Claude Code. Quoted file data.' }] }];
  try {
    await sdk.create({ thread: { type: 'create' }, messages: messages.slice(0, 1) });
    for (const type of ['continue', 'continue_no_save']) {
      const delta = { thread: { type, previous_message_id: 'fixture-response' }, messages: messages.slice(2) };
      await sdk.create(null, { body: JSON.stringify(delta) });
      assert.deepEqual(requests.at(-1), delta);
    }
    scope.__clawgodAssembly = Object.freeze({ customPrompt: 'Thread BETA fixture.' });
    for (const thread of [{ type: 'create' }, undefined]) {
      await sdk.create({ ...(thread && { thread }), messages, tools: [{ name: 'Read', input_schema: { type: 'object' } }] });
      const request = requests.at(-1);
      assert.deepEqual(request.messages, messages, 'tool call/result pairs and quoted file data must be unchanged');
      assert.match(request.system[0].text, /Thread BETA fixture/);
      assert.ok(!JSON.stringify(request.system).includes('Thread ALPHA fixture'));
      assert.equal(request.system.length, 1);
    }
    assert.throws(() => sdk.create({ thread: { type: 'future_unknown_type' }, messages }), /Unsupported Messages thread type/);
    assert.equal(requests.length, 5);
  } finally { upstream.stop(true); }
});
