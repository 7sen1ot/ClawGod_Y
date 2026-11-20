#!/usr/bin/env node
// @ts-check
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import pty from '@lydell/node-pty';
import xterm from '@xterm/headless';

const PROMPT = 'clawgod-smoke-182';
const REPLY = 'CLAWGOD_TUI_OK_182';
const MISSING_API = 'has no Bun.ant.CellSegmenter';
const { Terminal } = xterm;

/** @typedef {{cli: string, bun: string, native?: string, version: string, output: string, timeout: number, expectMissingWithoutShim: boolean}} Options */

/** @param {Options} args @param {string} name @param {string[]} command @param {boolean} shim */
async function runCase(args, name, command, shim, expectError = false) {
  const home = join(args.output, name + '-home');
  const cwd = join(home, 'project');
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(home, '.claude.json'), JSON.stringify({
    hasCompletedOnboarding: true, lastOnboardingVersion: args.version,
    theme: 'dark', customApiKeyResponses: { approved: ['ci-local-only'] },
    projects: Object.fromEntries([...new Set([cwd, cwd.replaceAll('\\', '/')])]
      .map(path => [path, { hasTrustDialogAccepted: true, projectOnboardingSeenCount: 1 }])),
  }));
  /** @type {{path: string, saw_prompt: boolean}[]} */
  const requests = [];
  let apiError;
  const server = createServer((request, response) => {
    const handle = async () => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      requests.push({ path: request.url || '/', saw_prompt: JSON.stringify(body.messages || []).includes(PROMPT) });
      const message = {
        id: 'msg_ci', type: 'message', role: 'assistant', model: body.model || 'ci-model',
        content: [{ type: 'text', text: REPLY }], stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 8 },
      };
      if (request.url?.includes('count_tokens')) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{"input_tokens":10}');
      } else if (body.stream) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const events = [
          { type: 'message_start', message: { ...message, content: [], stop_reason: null } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: REPLY } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } },
          { type: 'message_stop' },
        ];
        response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
      } else {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(message));
      }
    };
    handle().catch(error => {
      apiError = error;
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => accept(undefined));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local API did not bind a TCP port');
  const retained = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'LANG']);
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && retained.has(key.toUpperCase()))),
    HOME: home, USERPROFILE: home, TERM: 'xterm-256color', COLORTERM: 'truecolor',
    ANTHROPIC_API_KEY: 'ci-local-only', ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1',
    CLAWGOD_FEATURE_BUN_ANT_SHIM: String(shim),
  };
  if (args.native) env['CLAUDE_CODE_EXECPATH'] = args.native;
  if (process.platform === 'win32') {
    for (const [key, suffix] of [['APPDATA', 'Roaming'], ['LOCALAPPDATA', 'Local']]) {
      const directory = join(home, 'AppData', suffix);
      mkdirSync(directory, { recursive: true });
      env[key] = directory;
    }
  }
  const screen = new Terminal({ cols: 120, rows: 36, allowProposedApi: true });
  /** @type {import('@lydell/node-pty').IPty | undefined} */
  let terminal;
  let outputSubscription, exitSubscription;
  let raw = '', typedAt, terminalExited = false, terminalError;
  let submitted = false, headerSeen = false, passed = false;
  let reason = 'timeout waiting for interactive TUI';
  let pending = Promise.resolve();
  const started = performance.now();
  const visible = () => {
    const buffer = screen.buffer.active;
    return Array.from({ length: screen.rows }, (_, row) =>
      buffer.getLine(buffer.viewportY + row)?.translateToString(true) || '').join('\n');
  };
  const writeInput = text => {
    if (!terminal || terminalExited) return;
    try { terminal.write(text); } catch (error) { terminalError = error; }
  };
  // The emulator answers terminal capability/cursor queries as it parses them,
  // including queries split across output chunks.
  const replies = screen.onData(writeInput);
  try {
    terminal = pty.spawn(command[0], command.slice(1), {
      cwd, env, cols: 120, rows: 36, name: 'xterm-256color', useConpty: true,
    });
    outputSubscription = terminal.onData(text => {
      raw += text;
      pending = pending.then(() => new Promise(accept => screen.write(text, () => accept(undefined))));
    });
    exitSubscription = terminal.onExit(() => { terminalExited = true; });
    while (performance.now() - started < args.timeout * 1000) {
      await pending;
      if (apiError) throw apiError;
      if (terminalError) throw terminalError;
      const now = performance.now();
      if (typedAt !== undefined && !submitted && now - typedAt >= 200) {
        writeInput('\r');
        submitted = true;
      }
      const text = visible();
      if (raw.includes(MISSING_API)) {
        passed = expectError;
        reason = passed ? 'expected missing CellSegmenter error' : 'renderer API is missing';
        break;
      }
      if (raw.includes('Uncaught exception')) {
        reason = 'unexpected uncaught exception';
        break;
      }
      headerSeen ||= text.includes(name === 'native' ? 'Claude Code' : 'ClawGod_Y') && text.includes(args.version);
      if (!expectError && headerSeen && text.includes('❯') && typedAt === undefined) {
        writeInput(PROMPT);
        typedAt = now;
      }
      if (!expectError && submitted && text.includes(REPLY) && requests.some(request => request.saw_prompt)) {
        passed = true;
        reason = 'header, keyboard input, local API request and rendered reply verified';
        break;
      }
      if (terminalExited) {
        reason = 'process/PTY exited before the expected result';
        break;
      }
      await delay(50);
    }
  } catch (error) {
    reason = error.message;
    throw error;
  } finally {
    try {
      outputSubscription?.dispose();
      if (terminal && !terminalExited) terminal.kill(process.platform === 'win32' ? undefined : 'SIGKILL');
    } finally {
      exitSubscription?.dispose();
      replies.dispose();
      await pending;
      server.closeAllConnections();
      await new Promise(accept => server.close(() => accept(undefined)));
      writeFileSync(join(args.output, `${name}.raw.log`), raw);
      writeFileSync(join(args.output, `${name}.screen.txt`), visible());
      screen.dispose();
      const result = {
        case: name, passed, reason, header_seen: headerSeen, submitted, requests,
        seconds: Math.round((performance.now() - started) / 10) / 100,
      };
      writeFileSync(join(args.output, `${name}.json`), JSON.stringify(result, null, 2));
      console.log(JSON.stringify(result));
    }
  }
  if (!passed) throw new Error(`${name}: ${reason}; see ${args.output}`);
}

const { values } = parseArgs({ options: {
  cli: { type: 'string' }, bun: { type: 'string' }, native: { type: 'string' },
  version: { type: 'string' }, output: { type: 'string' }, timeout: { type: 'string', default: '60' },
  'expect-missing-without-shim': { type: 'boolean', default: false },
} });
try {
  for (const key of ['cli', 'bun', 'version', 'output']) if (!values[key]) throw new Error(`--${key} is required`);
  const timeout = Number(values.timeout);
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('--timeout must be a positive number');
  const args = {
    cli: resolve(values.cli), bun: resolve(values.bun), native: values.native ? resolve(values.native) : undefined,
    version: values.version, output: resolve(values.output), timeout,
    expectMissingWithoutShim: values['expect-missing-without-shim'],
  };
  mkdirSync(args.output, { recursive: true });
  if (args.native) await runCase(args, 'native', [args.native], false);
  if (args.expectMissingWithoutShim) await runCase(args, 'shim-off', [args.bun, args.cli], false, true);
  await runCase(args, 'shim-on', [args.bun, args.cli], true);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
