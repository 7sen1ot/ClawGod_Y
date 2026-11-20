
// @ts-check
/** @typedef {{apiKey: string, baseURL: string, model?: string, effort?: string, timeoutMs?: number|string}} ProxyConfig */
/** @typedef {{role: string, content: any, tool_call_id?: string, tool_calls?: any[]}} ChatMessage */
/** @typedef {{model: string, messages: ChatMessage[], stream: boolean, max_tokens?: number, temperature?: number, top_p?: number, stop?: string[], reasoning_effort?: string, tools?: any[], tool_choice?: any, parallel_tool_calls?: boolean, response_format?: any, stream_options?: {include_usage: boolean}}} ChatRequest */
/** @typedef {{id: string, name: string, args: string, index: number|null, sent: number, ready: boolean, closed: boolean}} StreamTool */
const encoder = new TextEncoder();

function textParts(content, context) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) throw new Error(context + ' must be text or content blocks');
  return content.map(function (block) {
    if (block.type !== 'text') throw new Error(context + ': unsupported block ' + block.type);
    return textValue(block.text);
  }).join('\n');
}

function textValue(value) {
  if (typeof value !== 'string') throw new Error('Text content must be a string');
  return value;
}

function userPart(block) {
  if (block.type === 'text') return { type: 'text', text: textValue(block.text) };
  let source = block.source || {};
  if (block.type === 'image') {
    if (source.type === 'base64' && source.data && /^image\//.test(source.media_type))
      return { type: 'image_url', image_url: { url: 'data:' + source.media_type + ';base64,' + source.data } };
    if (source.type === 'url' && source.url) return { type: 'image_url', image_url: { url: source.url } };
    throw new Error('Unsupported image source');
  }
  if (block.type === 'document') {
    if (block.citations && block.citations.enabled) throw new Error('Document citations are not supported by openai-chat');
    if (source.type === 'text') return { type: 'text', text: textValue(source.data) };
    // Some Chat Completions providers accept a public PDF URL in file_data.
    if (source.type === 'url' && typeof source.url === 'string' && URL.canParse(source.url) && /^https?:\/\//i.test(source.url))
      return { type: 'file', file: { filename: block.title || 'document.pdf', file_data: source.url } };
    if (source.type === 'base64' && source.media_type === 'application/pdf' && source.data)
      return { type: 'file', file: { filename: block.title || 'document.pdf', file_data: 'data:application/pdf;base64,' + source.data } };
    throw new Error('Unsupported document source; use base64 PDF, a URL, or text');
  }
  throw new Error('Unsupported user content block: ' + block.type);
}

/** @returns {ChatMessage[]} */
function translateMessages(msgs) {
  if (!Array.isArray(msgs)) throw new Error('messages must be an array');
  let out = [];
  for (let msg of msgs) {
    if (msg.role === 'system') {
      out.push({ role: 'system', content: textParts(msg.content, 'System message') });
      continue;
    }
    if (msg.role !== 'user' && msg.role !== 'assistant') throw new Error('Unsupported message role: ' + msg.role);
    if (typeof msg.content === 'string') { out.push({ role: msg.role, content: msg.content }); continue; }
    if (!Array.isArray(msg.content)) throw new Error('Message content must be text or content blocks');
    if (msg.role === 'user') {
      let parts = [];
      for (let block of msg.content) {
        if (block.type === 'tool_result') {
          let text = block.content === undefined ? '' : textParts(block.content, 'Tool result');
          out.push({ role: 'tool', tool_call_id: block.tool_use_id, content: (block.is_error ? '[ERROR] ' : '') + text });
        } else parts.push(userPart(block));
      }
      if (parts.length) out.push({ role: 'user', content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts });
    } else {
      let textContent = '', toolCalls = [];
      for (let b of msg.content) {
        if (b.type === 'text') textContent += textValue(b.text);
        else if (b.type === 'tool_use') toolCalls.push({ id: b.id, type: 'function', function: { name: b.name, arguments: typeof b.input === 'string' ? b.input : JSON.stringify(b.input) } });
        else if (b.type !== 'thinking' && b.type !== 'redacted_thinking') throw new Error('Unsupported assistant content block: ' + b.type);
      }
      /** @type {ChatMessage} */
      let assistantMsg = { role: 'assistant', content: textContent || null };
      if (toolCalls.length) assistantMsg.tool_calls = toolCalls;
      out.push(assistantMsg);
    }
  }
  return out;
}

function translateRequest(body, configuredEffort) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Request must be an object');
  let messages = body.system ? [{ role: 'system', content: textParts(body.system, 'System prompt') }] : [];
  /** @type {ChatRequest} */
  let result = { model: body.model, messages: messages.concat(translateMessages(body.messages || [])), stream: !!body.stream };
  if (body.max_tokens !== undefined) result.max_tokens = body.max_tokens;
  if (body.temperature !== undefined) result.temperature = body.temperature;
  if (body.top_p !== undefined) result.top_p = body.top_p;
  if (body.stop_sequences) result.stop = body.stop_sequences;
  let effort = configuredEffort || (body.output_config && body.output_config.effort);
  if (effort && effort !== 'auto') result.reasoning_effort = effort === 'max' ? 'xhigh' : effort;
  if (body.tools && body.tools.length) result.tools = body.tools.map(function (tool) {
    if (tool.type && tool.type !== 'custom') throw new Error('Unsupported tool type: ' + tool.type);
    return { type: 'function', function: { name: tool.name, description: tool.description || '', parameters: tool.input_schema || { type: 'object', properties: {} } } };
  });
  if (body.tool_choice) {
    let choice = body.tool_choice;
    if (choice.type === 'tool' && choice.name) result.tool_choice = { type: 'function', function: { name: choice.name } };
    else if (choice.type === 'any') result.tool_choice = 'required';
    else if (choice.type === 'auto' || choice.type === 'none') result.tool_choice = choice.type;
    else throw new Error('Unsupported tool_choice');
    if (choice.disable_parallel_tool_use !== undefined) result.parallel_tool_calls = !choice.disable_parallel_tool_use;
  }
  let format = body.output_config?.format;
  if (format != null) {
    if (format.type === 'json_object') result.response_format = { type: 'json_object' };
    else {
      // Anthropic puts schema directly on format. Also accept the existing OpenAI-shaped wrapper.
      const definition = format.schema !== undefined ? format : format.json_schema;
      const schema = definition?.schema;
      if (format.type !== 'json_schema' || !schema || typeof schema !== 'object' || Array.isArray(schema))
        throw new Error('output_config.format requires json_object or json_schema with an object schema');
      if (definition.strict != null && typeof definition.strict !== 'boolean') throw new Error('json_schema.strict must be boolean');
      result.response_format = { type: 'json_schema', json_schema: {
        name: definition.name || 'output', schema, strict: definition.strict ?? (definition === format),
      } };
    }
  }
  if (body.stream) result.stream_options = { include_usage: true };
  return result;
}

function textTokens(text) {
  let units = text.length;
  for (const run of text.matchAll(/[^a-zA-Z0-9\s]+/g)) units += 2 * run[0].length;
  return Math.ceil(units / 3);
}

function messageTokens(messages) {
  let total = 0;
  for (const { content, ...fields } of messages) {
    total += 4 + textTokens(JSON.stringify(fields));
    if (!Array.isArray(content)) total += textTokens(content || '');
    else for (const part of content) {
      if (part.type === 'text') total += textTokens(part.text);
      else if (part.file?.file_data.startsWith('data:application/pdf;base64,'))
        total += Math.ceil((part.file.file_data.length - 'data:application/pdf;base64,'.length) / 4);
      else total += 1600;
    }
  }
  return total;
}

function inputSettings(request) {
  return [request.tools, request.tool_choice, request.parallel_tool_calls, request.response_format, request.reasoning_effort];
}

function prefixKey(request, length) {
  return Bun.hash(JSON.stringify([request.model, inputSettings(request), request.messages.slice(0, length)]));
}

function mapFinishReason(reason, hasToolCalls) {
  if (reason === 'tool_calls' || (reason === 'stop' && hasToolCalls)) return 'tool_use';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'content_filter') return 'refusal';
  if (reason === 'stop') return 'end_turn';
  throw new Error('Unsupported upstream finish_reason: ' + reason);
}

function toolInput(argumentsText) {
  let input = JSON.parse(argumentsText || '{}');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Tool arguments must be a JSON object');
  return input;
}

function usageOf(usage = undefined) {
  return { input_tokens: (usage && usage.prompt_tokens) || 0, output_tokens: (usage && usage.completion_tokens) || 0 };
}

function messageOf(response, model, content, stopReason, usage) {
  return { id: response.id || ('msg_' + Date.now()), type: 'message', role: 'assistant', content, model: model || response.model, stop_reason: stopReason, stop_sequence: null, usage };
}

function translateResponse(response, model) {
  if (response.error) throw new Error(response.error.message || 'Upstream API error');
  let choice = response.choices && response.choices[0];
  if (!choice || !choice.message || typeof choice.message !== 'object') throw new Error('No message in upstream response');
  let content = [], message = choice.message;
  if (message.content !== undefined && message.content !== null) content.push({ type: 'text', text: textValue(message.content) });
  if (message.refusal) content.push({ type: 'text', text: textValue(message.refusal) });
  for (let tc of message.tool_calls || []) {
    if (!tc.id || !tc.function || !tc.function.name) throw new Error('Incomplete upstream tool call');
    content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: toolInput(tc.function.arguments) });
  }
  return messageOf(response, model, content, mapFinishReason(choice.finish_reason, content.some(function (b) { return b.type === 'tool_use'; })), usageOf(response.usage));
}

function sse(event, data) { return 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'; }

function createStreamTranslator(model, recordUsage) {
  let started = false, finished = false, stopped = false, textIndex = null, nextIndex = 0;
  /** @type {Map<number, StreamTool>} */
  const tools = new Map();
  let usage = usageOf(), reason, activeTool = null, pendingText = '';
  return function (chunk) {
    if (stopped) throw new Error('Data after stream end');
    let events = [];
    function emit(type, fields) { events.push(sse(type, { type: type, ...fields })); }
    function closeText() {
      if (textIndex === null) return;
      emit('content_block_stop', { index: textIndex });
      textIndex = null;
    }
    function emitText(text) {
      if (textIndex === null) { textIndex = nextIndex++; emit('content_block_start', { index: textIndex, content_block: { type: 'text', text: '' } }); }
      emit('content_block_delta', { index: textIndex, delta: { type: 'text_delta', text: text } });
    }
    function flushTools(final) {
      if (final) for (let tool of tools.values()) {
        if (!tool.id || !tool.name) throw new Error('Incomplete upstream tool call');
        toolInput(tool.args);
      }
      // Keep Anthropic content blocks sequential; parallel calls wait for the active call.
      for (let tool of tools.values()) {
        if (tool.closed) continue;
        if (tool.index === null) {
          if (!final && !tool.ready) break;
          closeText();
          tool.index = nextIndex++;
          activeTool = tool;
          emit('content_block_start', { index: tool.index, content_block: { type: 'tool_use', id: tool.id, name: tool.name, input: {} } });
        }
        let partial = tool.args.slice(tool.sent) || (final && !tool.args ? '{}' : '');
        if (partial) emit('content_block_delta', { index: tool.index, delta: { type: 'input_json_delta', partial_json: partial } });
        tool.sent = tool.args.length;
        let complete = final;
        if (!complete && tool.args.trimEnd().endsWith('}')) {
          try { toolInput(tool.args); complete = true; } catch { /* JSON may still be incomplete. */ }
        }
        if (!complete) break;
        emit('content_block_stop', { index: tool.index });
        tool.closed = true;
        activeTool = null;
      }
      if (!activeTool && pendingText) {
        emitText(pendingText);
        pendingText = '';
      }
    }
    if (chunk === null) {
      if (!finished) throw new Error('Upstream stream ended before finish_reason');
      stopped = true;
      recordUsage(usage.input_tokens);
      emit('message_delta', { delta: { stop_reason: reason, stop_sequence: null }, usage: usage });
      emit('message_stop', {});
      return events;
    }
    if (chunk.error) throw new Error(chunk.error.message || 'Upstream stream error');
    if (chunk.usage) usage = usageOf(chunk.usage);
    let choice = chunk.choices && chunk.choices.find(function (c) { return c.index === undefined || c.index === 0; });
    if (!choice) {
      if (!Array.isArray(chunk.choices)) throw new Error('Invalid upstream stream chunk');
      return events;
    }
    if (finished) throw new Error('Completion data after finish_reason');
    if (!started) {
      started = true;
      emit('message_start', { message: messageOf(chunk, model, [], null, usage) });
    }
    let delta = choice.delta || {};
    let text = delta.content || delta.refusal;
    if (text) {
      textValue(text);
      if (activeTool) pendingText += text;
      else emitText(text);
    }
    for (let tc of delta.tool_calls || []) {
      if (!Number.isInteger(tc.index) || tc.index < 0) throw new Error('Invalid upstream tool index');
      if (!tools.has(tc.index)) tools.set(tc.index, { id: '', name: '', args: '', index: null, sent: 0, ready: false, closed: false });
      let buf = tools.get(tc.index);
      if (buf.index !== null && (tc.id || tc.function?.name)) throw new Error('Upstream tool metadata changed after arguments began');
      if (tc.id) buf.id += tc.id;
      if (tc.function) {
        buf.name += tc.function.name || '';
        let args = tc.function.arguments ?? '';
        textValue(args);
        if (buf.closed && args.trim()) throw new Error('Upstream tool arguments continued after a complete JSON object');
        buf.args += args;
        // An argument-only delta marks the end of potentially fragmented metadata.
        if (tc.function.arguments !== undefined && !tc.id && !tc.function.name && buf.id && buf.name) buf.ready = true;
      }
    }
    if (choice.finish_reason) {
      reason = mapFinishReason(choice.finish_reason, tools.size > 0);
      flushTools(true);
      closeText();
      finished = true;
    } else flushTools(false);
    return events;
  };
}

async function* translateStream(reader, model, recordUsage) {
  let decoder = new TextDecoder(), buffer = '', data = [], translate = createStreamTranslator(model, recordUsage);
  function payload(line) {
    if (line === '') { let result = data.length ? data.join('\n') : undefined; data = []; return result; }
    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  while (true) {
    let read = await reader.read();
    buffer += read.done ? decoder.decode() : decoder.decode(read.value, { stream: true });
    if (read.done && buffer && !/[\r\n]$/.test(buffer)) buffer += '\n';
    let match;
    while ((match = /[\r\n]/.exec(buffer))) {
      let offset = match.index;
      if (!read.done && buffer[offset] === '\r' && offset === buffer.length - 1) break;
      let line = buffer.slice(0, offset);
      buffer = buffer.slice(offset + (buffer.slice(offset, offset + 2) === '\r\n' ? 2 : 1));
      let value = payload(line);
      if (value === undefined) continue;
      if (value === '[DONE]') { yield* translate(null); return; }
      yield* translate(JSON.parse(value));
    }
    if (read.done) {
      if (data.length) {
        let tail = data.join('\n');
        if (tail !== '[DONE]') yield* translate(JSON.parse(tail));
      }
      yield* translate(null);
      return;
    }
  }
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: { 'Content-Type': 'application/json', ...headers } });
}
function errorResponse(status, message) {
  let types = { 400: 'invalid_request_error', 401: 'authentication_error', 403: 'permission_error', 404: 'not_found_error', 429: 'rate_limit_error' };
  return json({ type: 'error', error: { type: types[status] || 'api_error', message: message } }, status);
}

/** @param {ProxyConfig} config */
function startProxy(config) {
  let upstreamURL = new URL(config.baseURL || 'https://api.x.ai/v1');
  if (!['http:', 'https:'].includes(upstreamURL.protocol) || upstreamURL.username || upstreamURL.password || upstreamURL.search || upstreamURL.hash)
    throw new Error('OpenAI baseURL must be an HTTP(S) API base without credentials, query, or fragment');
  upstreamURL.pathname = upstreamURL.pathname.replace(/\/+$/, '') + '/chat/completions';
  /** @type {Map<number|bigint, {key: number|bigint, length: number, tokens: number}>} */
  const recentCounts = new Map();
  let server = Bun.serve({
    port: 0, hostname: '127.0.0.1', idleTimeout: 255,
    fetch: async function (req) {
      let path = new URL(req.url).pathname;
      if (req.method === 'GET' && path === '/health') return new Response('ok');
      let count = path === '/v1/messages/count_tokens' || path === '/messages/count_tokens';
      if (req.method !== 'POST' || (!count && path !== '/v1/messages' && path !== '/messages')) return errorResponse(404, 'Not found');
      let body, request;
      try {
        body = await req.json();
        request = translateRequest(body, config.effort);
        request.model = body.model || config.model || '';
      } catch (e) { return errorResponse(400, 'Translation error: ' + e.message); }
      if (count) {
        let prefix;
        const lengths = [...new Set([...recentCounts.values()].map(entry => entry.length))].sort((a, b) => b - a);
        for (const length of lengths) {
          if (length > request.messages.length) continue;
          prefix = recentCounts.get(prefixKey(request, length));
          if (prefix) {
            recentCounts.delete(prefix.key);
            recentCounts.set(prefix.key, prefix);
            break;
          }
        }
        const exact = prefix && request.messages.length === prefix.length;
        const tokens = prefix ? prefix.tokens + messageTokens(request.messages.slice(prefix.length))
          : messageTokens(request.messages) + textTokens(JSON.stringify(inputSettings(request).filter(v => v != null)));
        return json({ input_tokens: Math.max(1, tokens) }, 200, { 'x-clawgod-token-count': exact ? 'upstream' : 'estimate' });
      }
      function recordUsage(tokens) {
        if (Number.isSafeInteger(tokens) && tokens > 0) {
          const length = request.messages.length;
          const key = prefixKey(request, length);
          recentCounts.delete(key);
          recentCounts.set(key, { key, length, tokens });
          if (recentCounts.size > 128) recentCounts.delete(recentCounts.keys().next().value);
        }
      }

      let abort = new AbortController();
      let onAbort = function () { abort.abort(req.signal.reason); };
      req.signal.addEventListener('abort', onAbort, { once: true });
      if (req.signal.aborted) onAbort();
      let timeout = Number(config.timeoutMs) || 3000000;
      let timer = setTimeout(function () { abort.abort(new Error('Upstream request timed out')); }, timeout);
      if (timer.unref) timer.unref();
      function cleanup() { clearTimeout(timer); req.signal.removeEventListener('abort', onAbort); }
      let upstream;
      try {
        upstream = await fetch(upstreamURL.href, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.apiKey }, body: JSON.stringify(request), signal: abort.signal });
        if (!upstream.ok) {
          let errText = await upstream.text(), errBody;
          try { errBody = JSON.parse(errText); } catch {}
          let response = errorResponse(upstream.status, (errBody && errBody.error && errBody.error.message) || errText || ('HTTP ' + upstream.status));
          let retryAfter = upstream.headers.get('retry-after');
          if (retryAfter) response.headers.set('retry-after', retryAfter);
          cleanup();
          return response;
        }
        if (!request.stream) {
          let result = translateResponse(await upstream.json(), request.model);
          recordUsage(result.usage.input_tokens);
          cleanup();
          return json(result);
        }
        if (!upstream.body || !(upstream.headers.get('content-type') || '').toLowerCase().startsWith('text/event-stream'))
          throw new Error('Expected an upstream text/event-stream response');
      } catch (e) {
        abort.abort();
        cleanup();
        return errorResponse(502, 'Upstream request failed: ' + e.message);
      }

      let reader = upstream.body.getReader(), iterator = translateStream(reader, request.model, recordUsage), cancelled = false;
      async function closeReader() { try { await reader.cancel(); } catch {} cleanup(); }
      let readable = new ReadableStream({
        async pull(controller) {
          try {
            let next = await iterator.next();
            if (cancelled) return;
            if (next.done) { await closeReader(); controller.close(); }
            else controller.enqueue(encoder.encode(next.value));
          } catch (e) {
            if (!cancelled) {
              controller.enqueue(encoder.encode(sse('error', { type: 'error', error: { type: 'api_error', message: 'Stream error: ' + e.message } })));
              controller.close();
            }
            abort.abort();
            await closeReader();
          }
        },
        async cancel() { cancelled = true; abort.abort(); await closeReader(); await iterator.return(); },
      });
      return new Response(readable, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
    },
  });
  return { port: server.port, stop: function () { server.stop(); } };
}

export { startProxy };
