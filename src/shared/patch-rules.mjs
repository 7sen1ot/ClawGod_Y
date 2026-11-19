const gate = (id) => `globalThis.__clawgodPatches?.[${JSON.stringify(id)}]!==!1`;

export const upstreamPatches = [
  {
    id: 'session-project-paths',
    name: 'Keep ClawGod_Y transcripts separate from upstream configuration',
    ast: true,
    required: true,
  },
  {
    id: 'session-history-paths',
    name: 'Keep ClawGod_Y prompt history separate from upstream history',
    ast: true,
    required: true,
  },
  {
    id: 'session-state-paths',
    name: 'Keep session state and cleanup paths in the ClawGod_Y directory',
    ast: true,
    optional: true,
  },
  {
    id: 'instruction-files-off',
    name: 'Exclude user and project CLAUDE.md and AGENTS.md instructions',
    ast: true,
    required: true,
  },
  {
    id: 'agents-md-off',
    name: 'Disable automatic AGENTS.md instruction loading',
    ast: true,
    optional: true,
  },
  {
    id: 'terminal-reply-fragments',
    name: 'Preserve split terminal replies while a DA1 probe is pending',
    // 2.1.327 reads the clock before the retry guard. Reuse the timestamp passed to the flush.
    pattern: /(if\(this\.props\.stdin\.readableLength>0(?:\|\|this\.querier\?\.owed\(\)&&[\w$]+<this\.querier\.repliesDueBy)?\)\{this\.incompleteEscapeTimer=setTimeout\(this\.flushIncomplete,[\w$]+\);return\}(?:let [\w$]+=performance\.now\(\);)?)(this\.applyKeysRead\([\w$]+\(this\.keyReader,([\w$]+)\),\3\)\})/g,
    replacer: (m, prefix, suffix, now) => prefix +
      `const _clawgodReplyDelay=globalThis.__clawgodHelpers?.terminalReplyDelay?.(this.querier,this.keyReader,${now})??0;` +
      'if(_clawgodReplyDelay>0){this.incompleteEscapeTimer=setTimeout(this.flushIncomplete,_clawgodReplyDelay);return}' + suffix,
    optional: true,
  },
  {
    id: 'user-type-ant',
    name: 'USER_TYPE → ant',
    ast: true,
  },
  {
    id: 'bun-standalone-executable',
    name: 'Bun.isStandaloneExecutable → true',
    ast: true,
  },
  {
    id: 'growthbook-env-overrides',
    name: 'GrowthBook env overrides',
    coveredBy: ['growthbook-env-overrides-graph'],
    pattern: /function ([\w$]+)\(\)\{if\(!([\w$]+)\)\2=!0;return ([\w$]+)\}/g,
    replacer: (m, fn, flag, val) =>
      `function ${fn}(){if(!${flag}){${flag}=!0;try{let e=process.env.CLAUDE_INTERNAL_FC_OVERRIDES;if(e)${val}=JSON.parse(e)}catch(e){}}return ${val}}`,
    unique: true,
  },
  {
    id: 'growthbook-env-overrides-graph',
    name: 'GrowthBook env overrides (graph dead-code fix)',
    ast: true,
    optional: true,
  },
  {
    id: 'growthbook-config-overrides',
    name: 'GrowthBook config overrides',
    fallbackFor: ['growthbook-config-overrides-graph'],
    pattern: /function ([\w$]+)\(\)\{return\}(function)/g,
    replacer: (m, fn, next) =>
      `function ${fn}(){return null}${next}`,
    validate: (match, code, pos = code.indexOf(match)) => {
      const nearby = code.substring(Math.max(0, pos - 500), pos + 500);
      return nearby.includes('growthBook') || nearby.includes('GrowthBook') || nearby.includes('FeatureValue');
    },
  },
  {
    id: 'growthbook-config-overrides-graph',
    name: 'GrowthBook config overrides (class reader)',
    ast: true,
    optional: true,
  },
  {
    id: 'agent-teams',
    toggleable: true,
    name: 'Agent Teams always enabled',
    coveredBy: ['agent-teams-graph'],
    pattern: /function ([\w$]+)\(\)\{if\(![\w$]+\(process\.env\.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS\)&&![\w$]+\(\)\)return!1;if\(![\w$]+\("tengu_amber_flint",!0\)\)return!1;return!0\}/g,
    replacer: (m, fn) => `function ${fn}(){if(${gate('agent-teams')})return!0;` + m.slice(`function ${fn}(){`.length, -1) + `}`,
  },
  {
    id: 'agent-teams-graph',
    toggleable: true,
    name: 'Agent Teams always enabled (graph)',
    ast: true,
    optional: true,
  },
  {
    id: 'computer-use-sub',
    toggleable: true,
    name: 'Computer Use subscription bypass',
    pattern: /function ([\w$]+)\(\)\{let [\w$]+=[\w$]+\(\);return [\w$]+==="max"\|\|[\w$]+==="pro"\}/g,
    replacer: (m, fn) => `function ${fn}(){if(${gate('computer-use-sub')})return!0;` + m.slice(`function ${fn}(){`.length, -1) + `}`,
  },
  {
    id: 'computer-use-default',
    toggleable: true,
    name: 'Computer Use default enabled',
    ast: true,
  },
  {
    id: 'computer-use-gate-semantic',
    toggleable: true,
    name: 'Computer Use gate (resolved configuration contract)',
    ast: true,
    optional: true,
  },
  {
    id: 'ultraplan',
    toggleable: true,
    name: 'Ultraplan enable',
    ast: true,
  },
  {
    id: 'ultrareview-gate',
    toggleable: true,
    name: 'Ultrareview enable (rQt gate)',
    pattern: /function ([\w$]+)\(\)\{return ([\w$]+)\(\)\?\.enabled===!0&&[\w$]+\(\)&&![\w$]+\(\)\}/g,
    replacer: (m, fn) => `function ${fn}(){return ${gate('ultrareview-gate')}?!0:(${m.slice(`function ${fn}(){return `.length, -1)})}`,
    optional: true,
  },
  {
    id: 'ultrareview-command',
    toggleable: true,
    name: 'Ultrareview command (resolved availability callback)',
    ast: true,
    optional: true,
  },
  {
    id: 'ultrareview-direct',
    toggleable: true,
    name: 'Ultrareview enable (direct literal, <=2.1.213)',
    versions: '<=2.1.213',
    pattern: /function ([\w$]+)\(\)\{return ([\w$]+)\("tengu_review_bughunter_config",null\)(\?\.enabled===!0)?\}/g,
    replacer: (m, fn, getter, hasGate) =>
      hasGate
        ? `function ${fn}(){if(${gate('ultrareview-direct')})return!0;` + m.slice(`function ${fn}(){`.length, -1) + `}`
        : `function ${fn}(){let _r=${getter}("tengu_review_bughunter_config",null);return ${gate('ultrareview-direct')}?_r?{..._r,enabled:!0}:{enabled:!0}:_r}`,
    optional: true,
  },
  {
    id: 'computer-use-gate',
    toggleable: true,
    name: 'Computer Use gate bypass',
    pattern: /function ([\w$]+)\(\)\{return [\w$]+\(\)&&[\w$]+\(\)\.enabled\}/g,
    replacer: (m, fn) => `function ${fn}(){return ${gate('computer-use-gate')}?!0:(${m.slice(`function ${fn}(){return `.length, -1)})}`,
  },
  {
    id: 'voice-mode',
    toggleable: true,
    name: 'Voice Mode enable (bypass GrowthBook kill)',
    ast: true,
  },
  {
    id: 'classifier-timeout',
    toggleable: true,
    name: 'Auto-mode classifier timeout override (CLAWGOD_CLASSIFIER_TIMEOUT_MS)',
    pattern: /function ([\w$]+)\(([\w$]+)\)\{let ([\w$]+)=Math\.max\(0,Math\.ceil\(\(\2-50000\)\/50000\)\);return Math\.min\(([\w$]+),([\w$]+)\+\3\*1e4\)\}/g,
    replacer: (m, fn, arg, step, cap, base) =>
      `function ${fn}(${arg}){let _ct=${gate('classifier-timeout')}?globalThis.__clawgodHelpers.classifierTimeoutFloor(process.env.CLAWGOD_CLASSIFIER_TIMEOUT_MS):null;let ${step}=Math.max(0,Math.ceil((${arg}-50000)/50000));let _r=Math.min(${cap},${base}+${step}*1e4);return _ct===null?_r:Math.max(_r,_ct)}`,
    unique: true,
    optional: true,
    fallbacks: [{
      pattern: /function\s+([\w$]+)\s*\(\s*([\w$]+)\s*\)\s*\{\s*(?:let|const|var)\s+([\w$]+)\s*=\s*Math\.max\(\s*0\s*,\s*Math\.ceil\(\s*\(\s*\2\s*-\s*(?:50000|50_000|5[eE]4)\s*\)\s*\/\s*(?:50000|50_000|5[eE]4)\s*\)\s*\)\s*;\s*return\s+Math\.min\(\s*([\w$]+)\s*,\s*([\w$]+)\s*\+\s*\3\s*\*\s*(?:1[eE]4|10000|10_000)\s*\)\s*;?\s*\}/g,
      nodeType: ['FunctionDeclaration', 'FunctionExpression'],
    }],
  },
  {
    id: 'classifier-model',
    toggleable: true,
    name: 'Auto-mode classifier model override (CLAWGOD_CLASSIFIER_MODEL)',
    pattern: /function ([\w$]+)\(\)\{(?:if\((?:[\w$]+\.CLAUDE_CODE_USER_DELEGATED_SESSION_DIRECT_API|[\w$]+\(\))\)return\{value:[\w$]+\(\)\?\?"",src:"default"\};)?let [\w$]+=[\w$]+\(\),[\w$]+=[\w$]+\(.*?\),[\w$]+=[\w$]+\([\w$]+\?\.modelByMainModel,\{vet:/g,
    replacer: (m, fn) =>
      `function ${fn}(){let _cm=process.env.CLAWGOD_CLASSIFIER_MODEL?.trim();if(_cm&&${gate('classifier-model')})return{value:_cm,src:"default"};` + m.slice(m.indexOf('{') + 1),
    sentinel: ['modelByMainModel'],
    unique: true,
    optional: true,
  },
  {
    id: 'classifier-retries',
    toggleable: true,
    name: 'Auto-mode classifier retries override (CLAWGOD_CLASSIFIER_RETRIES)',
    pattern: /function ([\w$]+)\(\)\{let [\w$]+=[\w$]+\([^)]*\)\?\.maxRetries;return typeof [\w$]+==="number"&&Number\.isInteger\([\w$]+\)&&[\w$]+>=0\?{value:[\w$]+,src:"gb"}:{value:([\w$]+),src:"default"\}\}/g,
    replacer: (m, fn) =>
      `function ${fn}(){let _cr=process.env.CLAWGOD_CLASSIFIER_RETRIES?.trim();if(${gate('classifier-retries')}&&_cr!==undefined&&_cr!==""&&Number.isInteger(+_cr)&&+_cr>=0)return{value:+_cr,src:"default"};` + m.slice(m.indexOf('{') + 1),
    unique: true,
    optional: true,
    fallbacks: [{
      pattern: /function\s+([\w$]+)\s*\(\s*\)\s*\{\s*(?:let|const|var)\s+([\w$]+)\s*=\s*[^;{}]{1,300}?\?\.maxRetries\s*;\s*return\s+typeof\s+\2\s*===?\s*["']number["']\s*&&\s*Number\.isInteger\(\s*\2\s*\)\s*&&\s*\2\s*>=\s*0\s*\?\s*\{\s*value\s*:\s*\2\s*,\s*src\s*:\s*["']gb["']\s*\}\s*:\s*\{\s*value\s*:\s*[\w$]+\s*,\s*src\s*:\s*["']default["']\s*\}\s*;?\s*\}/g,
      nodeType: ['FunctionDeclaration', 'FunctionExpression'],
    }],
  },
  {
    id: 'auto-mode-helper-gate',
    toggleable: true,
    name: 'Auto-mode unlock for third-party API (provider helper gate)',
    pattern: /if\(!([\w$]+)\(([\w$]+)\)\)return!1;(?=(?:(?!function\s).){0,300}!=="firstParty")/g,
    replacer: (m) => `if(globalThis.__clawgodPatches?.[${JSON.stringify('auto-mode-helper-gate')}]===!1&&` + m.slice(3, -10) + `)return!1;`,
    optional: true,
  },
  {
    id: 'auto-mode-inline-gate',
    toggleable: true,
    name: 'Auto-mode unlock for third-party API (inline gate)',
    pattern: /if\((?:([\w$]+)!=="firstParty"&&(?:\1!=="anthropicAws"|![\w$]+\(\1\))[^;]*|[\w$]+\(\)&&\([\w$]+==="claude-opus-4-6"\|\|[\w$]+==="claude-sonnet-4-6"\|\|[\w$]+\.includes\("haiku"\)[^;]*?\))\)return!1;/g,
    replacer: (m) => `if(globalThis.__clawgodPatches?.[${JSON.stringify('auto-mode-inline-gate')}]===!1&&` + m.slice(3, -10) + `)return!1;`,
    sentinel: ['!=="firstParty"', '&&'],
    fallbacks: [{
      // 2.1.323 splits the provider/model denial and the Haiku denial into separate returns.
      pattern: /(function [\w$]+\(([\w$]+)\)\{let ([\w$]+)=[\w$]+\(\2\);if\([\w$]+\(\3\)\)return!1;let ([\w$]+)=[\w$]+\(\);)if\((\4&&\(\3==="claude-opus-4-6"\|\|\3==="claude-sonnet-4-6"\))\)return!1;(let ([\w$]+)=[\w$]+\(\)==="firstParty"&&[^;{}]+;)return(!\(\(\4\|\|\7\)&&\3\.includes\("haiku"\)&&\3!=="claude-haiku-5-5"\))\}/g,
      nodeType: ['FunctionDeclaration', 'FunctionExpression'],
      replacer: (m, prefix, arg, model, provider, denial, setup, firstParty, result) =>
        `${prefix}if(!(${gate('auto-mode-inline-gate')})&&(${denial}))return!1;${setup}return ${gate('auto-mode-inline-gate')}||(${result})}`,
    }],
  },

  {
    id: 'macos-cmdv-image-paste',
    name: 'macOS Cmd+V image paste fallback to clipboard read',
    pattern: /if\(([\w$]+)\.length===0&&([\w$]+)\.length>0\)([\w$]+)\("input_image_drag","read_failed"\),([\w$]+)\.push\(\.\.\.\2\)/g,
    replacer: (m, L, R, at, D) =>
      `if(${L}.length===0&&${R}.length>0){${at}("input_image_drag","read_failed");if(d&&${D}.length===0){m();return}${D}.push(...${R})}`,
    sentinel: ['input_image_drag', 'read_failed'],
    optional: true,
  },

  {
    id: 'restore-search-tools',
    name: 'Restore Glob/Grep tools (un-inline EMBEDDED_SEARCH_TOOLS)',
    pattern: /function ([\w$]+)\(\)\{if\(!([\w$]+)\("true"\)\)return!1;if\([\w$]+\(\)\)return!1;return process\.env\.CLAUDE_CODE_ENTRYPOINT!=="local-agent"\}/g,
    replacer: (m, fn, envCheck) =>
      `function ${fn}(){if(!${envCheck}(process.env.EMBEDDED_SEARCH_TOOLS))return!1;if(typeof globalThis.__dpBinOk>"u"){try{var _w=process.platform==="win32"?"where":"which";require("child_process").execFileSync(_w,["bfs"],{timeout:2e3});require("child_process").execFileSync(_w,["ugrep"],{timeout:2e3});globalThis.__dpBinOk=!0}catch{globalThis.__dpBinOk=!1}}if(!globalThis.__dpBinOk)return!1;return process.env.CLAUDE_CODE_ENTRYPOINT!=="local-agent"}`,
    sentinel: ['EMBEDDED_SEARCH_TOOLS', 'local-agent', 'CLAUDE_CODE_ENTRYPOINT'],
    optional: true,
    fallbacks: [{
      pattern: /function\s+([\w$]+)\s*\(\s*\)\s*\{\s*if\s*\(\s*!([\w$]+)\(\s*["']true["']\s*\)\s*\)\s*return\s*(?:!1|false)\s*;\s*if\s*\(\s*[\w$]+\(\s*\)\s*\)\s*return\s*(?:!1|false)\s*;\s*return\s+process\.env\.CLAUDE_CODE_ENTRYPOINT\s*!==\s*["']local-agent["']\s*;?\s*\}/g,
      nodeType: ['FunctionDeclaration', 'FunctionExpression'],
    }],
  },

  {
    id: 'wiggly-dove',
    toggleable: true,
    name: 'Block wiggly-dove Git/environment collection',
    ast: true,
  },

  {
    id: 'geo-stego-date',
    toggleable: true,
    name: 'Neutralize geo-steganography in date string (qla)',
    ast: true,
  },
  {
    id: 'geo-detect-probe',
    toggleable: true,
    name: 'Neutralize geo-detection probe (rdp)',
    pattern: /function ([\w$]+)\(\)\{if\([\w$]+\(\)\)return null;let [\w$]+=[\w$]+\(\),[\w$]+=[\w$]+\(\),[\w$]+=[\w$]+==="Asia\/Shanghai"\|\|[\w$]+==="Asia\/Urumqi"[\s\S]*?\}\}/g,
    replacer: (m, fn) => `function ${fn}(){if(${gate('geo-detect-probe')})return null;` + m.slice(`function ${fn}(){`.length, -1) + `}`,
    sentinel: ['Asia/Shanghai', 'Asia/Urumqi'],
  },
  {
    id: 'geo-apostrophe-stego',
    toggleable: true,
    name: 'Neutralize apostrophe steganography (odp)',
    pattern: new RegExp(
      'function ([\\w$]+)\\(([\\w$]+),([\\w$]+)\\)\\{' +
      'if\\(!\\2&&!\\3\\)return"\'";' +
      'if\\(\\2&&!\\3\\)return"(?:\\\\u2019|\\u2019)";' +
      'if\\(!\\2&&\\3\\)return"(?:\\\\u02[Bb][Cc]|\\u02BC)";' +
      'return"(?:\\\\u02[Bb]9|\\u02B9)"\\}',
      'g'
    ),
    replacer: (m, fn, left, right) =>
      `function ${fn}(${left},${right}){if(${gate('geo-apostrophe-stego')})return"'";` + m.slice(m.indexOf('{') + 1, -1) + `}`,
    optional: true,
  },

  {
    id: 'remove-cyber-risk',
    toggleable: true,
    name: 'Remove CYBER_RISK_INSTRUCTION (unconditional)',
    coveredBy: ['pentest-prompt-rewrite'],
    pattern: /([\w$]+)="(IMPORTANT: Assist with authorized security testing[^"]*)"/g,
    replacer: (m, varName) => `${varName}=""`,
    sentinel: ['Assist with authorized security testing', 'IMPORTANT'],
  },
  {
    id: 'remove-url-restriction',
    toggleable: true,
    name: 'Remove URL generation restriction',
    pattern: /(\n\$\{[\w$]+\})(\nIMPORTANT: You must NEVER generate or guess URLs[^.]*\. You may use URLs provided by the user in their messages or local files\.)/g,
    replacer: (m, prefix, sentence) => `\${${gate('remove-url-restriction')}?"":\`${prefix}\`+'${sentence.replace('\n', '\\n')}'}`,
    sentinel: ['NEVER generate or guess URLs', 'URLs provided by the user'],
  },
  {
    id: 'remove-cautious-actions',
    toggleable: true,
    name: 'Remove cautious actions section',
    pattern: /function ([\w$]+)\(([\w$]*)\)\{(?:if\([\s\S]{1,200}?\)return`# Executing actions with care\n\n[\s\S]*?`;)?return`# Executing actions with care\n\n[\s\S]*?`\}/g,
    replacer: (m, fn, arg) => `function ${fn}(${arg}){if(${gate('remove-cautious-actions')})return\`\`;` + m.slice(`function ${fn}(${arg}){`.length, -1) + `}`,
    sentinel: ['# Executing actions with care'],
  },
  {
    id: 'remove-not-logged-in',
    toggleable: true,
    name: 'Remove "Not logged in" notice',
    pattern: /"(Not logged in\. Run [\w ]+ to authenticate\.)"/g,
    replacer: (m, orig) => `(${gate('remove-not-logged-in')}?"":'${orig}')`,
    optional: true,
    fallbacks: ['"Not logged in. Run /login to authenticate."', "'Not logged in. Run /login to authenticate.'"].map(pattern => ({
      pattern,
      nodeType: 'Literal',
      replacer: () => `(${gate('remove-not-logged-in')}?"":'Not logged in. Run \\x2flogin to authenticate.')`,
    })),
  },

  {
    id: 'attachment-filter-bypass',
    toggleable: true,
    name: 'Attachment filter bypass',
    pattern: /([\w$]+)\(\)!=="ant"(&&[\w$]+\.has\([\w$]+\.attachment\.type\)|\)\{if\([\w$]+\.attachment\.type==="hook_additional_context")/g,
    replacer: (m) => m.replace(/([\w$]+)\(\)!=="ant"(&&|\))/, (cm, f, sep) =>
      `(${gate('attachment-filter-bypass')}?!1:${f}()!=="ant")${sep}`),
    optional: true,
  },
  {
    id: 'message-filter-legacy',
    toggleable: true,
    name: 'Message list filter bypass (legacy ternary)',
    pattern: /([\w$]+)\(\)!=="ant"\?([\w$]+)\(([\w$]+),([\w$]+)\(([\w$]+)\)\):([\w$]+)/g,
    replacer: m => m.replace(/^([\w$]+)\(\)!=="ant"\?/, (g, f) => `(${gate('message-filter-legacy')}?!1:${f}()!=="ant")?`),
    optional: true,
  },
  {
    id: 'message-filter-s8',
    toggleable: true,
    name: 'Message list filter bypass (s_8 form)',
    pattern: /if\(([\w$]+)\(\)==="ant"\)return ([\w$]+);(?:if\([\w$]+\(\)&&[\w$]+\(\)\.project\?\.currentSessionCodeMode===!0\)return \2;)?let ([\w$]+)=([\w$]+) instanceof Set\?\4:(?:typeof \4==="function"\?\4\(\):)?([\w$]+)\(\4\);return ([\w$]+)\(\2,\3\)/g,
    replacer: m => m.replace(/if\(([\w$]+)\(\)==="ant"\)/, (g, f) => `if(${gate('message-filter-s8')}||${f}()==="ant")`),
    optional: true,
  },
  {
    id: 'shell-integration-orig',
    name: 'Shell integration → native execPath (multitool dispatch fix)',
    pattern: /([\w$]+\.join\([\w$]+\(\),[\w$]+\?)"claude\.exe":"claude"(\))/g,
    replacer: m => `/*clawgod:shell-integration-orig*/(process.env.CLAUDE_CODE_EXECPATH||${m})`,
    appliedSentinel: '/*clawgod:shell-integration-orig*/',
    validate: (match, code, pos) => {
      if (code.slice(Math.max(0, pos - 80), pos).endsWith('(process.env.CLAUDE_CODE_EXECPATH||')) return false;
      const nearby = code.slice(Math.max(0, pos - 500), pos + 1600);
      // In 2.1.327 the environment key moved farther away, but the shell fallback is still local.
      return nearby.includes('ARGV0=') &&
        (nearby.includes('CLAUDE_CODE_EXECPATH') || nearby.includes('[[ -x $_cc_bin ]] || _cc_bin='));
    },
    fallbacks: [{
      pattern: /[\w$]+(?:\.join)?\(\s*[\w$]+\(\s*\)\s*,\s*[\w$]+\s*\?\s*["']claude\.exe["']\s*:\s*["']claude["']\s*\)/g,
      nodeType: 'CallExpression',
    }],
    sentinel: ['claude.exe', '"claude"'],
    optional: true,
  },
  {
    id: 'remote-settings-off',
    toggleable: true,
    name: 'Ignore enterprise-managed remote settings',
    ast: true,
  },
  {
    id: 'tool-result-pairing-recovery',
    name: 'Recover orphaned tool results from message history',
    ast: true,
  },
];
