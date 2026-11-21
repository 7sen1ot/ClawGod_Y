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
    // Match the retry block, not its condition (rewritten in 2.1.329), and reuse the flush timestamp.
    pattern: /(\{this\.incompleteEscapeTimer=setTimeout\(this\.flushIncomplete,(?!_clawgodReplyDelay\))[\w$]+\);return\}(?:let [\w$]+=performance\.now\(\);)?)(this\.applyKeysRead\([\w$]+\(this\.keyReader,([\w$]+)\),\3\)\})/g,
    replacer: (m, prefix, suffix, now) => prefix +
      `const _clawgodReplyDelay=globalThis.__clawgodHelpers?.terminalReplyDelay?.(this.querier,this.keyReader,${now})??0;` +
      'if(_clawgodReplyDelay>0){this.incompleteEscapeTimer=setTimeout(this.flushIncomplete,_clawgodReplyDelay);return}' + suffix,
    appliedSentinel: 'const _clawgodReplyDelay=globalThis.__clawgodHelpers?.terminalReplyDelay?.(',
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
    name: 'Agent Teams always enabled',
    coveredBy: ['agent-teams-graph'],
    pattern: /function ([\w$]+)\(\)\{if\(![\w$]+\(process\.env\.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS\)&&![\w$]+\(\)\)return!1;if\(![\w$]+\("tengu_amber_flint",!0\)\)return!1;return!0\}/g,
    replacer: (m, fn) => `function ${fn}(){return!0}`,
  },
  {
    id: 'agent-teams-graph',
    name: 'Agent Teams always enabled (graph)',
    ast: true,
    optional: true,
  },
  {
    id: 'computer-use-sub',
    name: 'Computer Use subscription bypass',
    pattern: /function ([\w$]+)\(\)\{let [\w$]+=[\w$]+\(\);return [\w$]+==="max"\|\|[\w$]+==="pro"\}/g,
    replacer: (m, fn) => `function ${fn}(){return!0}`,
    fallbacks: [{
      // Preserve organization policy, including the app-list readability check added in 2.1.329.
      pattern: /(function [\w$]+\(\)\{if\([\w$]+\(\)\)return [\w$]+\([\w$]+\)===!0&&![\w$]+\(\)(?:&&[\w$]+\(\)\.readable)?;let ([\w$]+)=[\w$]+\(\);)return (\2==="max"\|\|\2==="pro")\}/g,
      nodeType: ['FunctionDeclaration', 'FunctionExpression'],
      replacer: (m, prefix) => `${prefix}return!0}`,
    }],
  },
  {
    id: 'computer-use-default',
    name: 'Computer Use default enabled',
    ast: true,
  },
  {
    id: 'computer-use-gate-semantic',
    name: 'Computer Use gate (resolved configuration contract)',
    ast: true,
    optional: true,
  },
  {
    id: 'ultraplan',
    name: 'Ultraplan enable',
    ast: true,
  },
  {
    id: 'ultrareview-command',
    name: 'Ultrareview command (resolved availability callback)',
    ast: true,
    optional: true,
  },
  {
    id: 'ultrareview-gate',
    name: 'Ultrareview enable (rQt gate)',
    ast: true,
    coveredBy: ['ultrareview-command'],
    optional: true,
  },
  {
    id: 'ultrareview-direct',
    name: 'Ultrareview enable (direct literal, <=2.1.213)',
    versions: '<=2.1.213',
    pattern: /function ([\w$]+)\(\)\{return ([\w$]+)\("tengu_review_bughunter_config",null\)(\?\.enabled===!0)?\}/g,
    replacer: (m, fn, getter, hasGate) =>
      hasGate
        ? `function ${fn}(){return!0}`
        : `function ${fn}(){let _r=${getter}("tengu_review_bughunter_config",null);return _r?{..._r,enabled:!0}:{enabled:!0}}`,
    optional: true,
  },
  {
    id: 'computer-use-gate',
    name: 'Computer Use gate bypass',
    coveredBy: ['computer-use-gate-semantic'],
    pattern: /function ([\w$]+)\(\)\{return [\w$]+\(\)&&[\w$]+\(\)\.enabled\}/g,
    replacer: (m, fn) => `function ${fn}(){return!0}`,
  },
  {
    id: 'classifier-timeout',
    name: 'Auto-mode classifier timeout override (CLAWGOD_CLASSIFIER_TIMEOUT_MS)',
    ast: true,
    optional: true,
  },
  {
    id: 'classifier-model',
    name: 'Auto-mode classifier model override (CLAWGOD_CLASSIFIER_MODEL)',
    ast: true,
    optional: true,
  },
  {
    id: 'classifier-retries',
    name: 'Auto-mode classifier retries override (CLAWGOD_CLASSIFIER_RETRIES)',
    ast: true,
    optional: true,
  },
  {
    id: 'auto-mode-helper-gate',
    name: 'Auto-mode unlock for third-party API (provider helper gate)',
    pattern: /if\(!([\w$]+)\(([\w$]+)\)\)return!1;(?=(?:(?!function\s).){0,300}!=="firstParty")/g,
    replacer: () => '',
    optional: true,
  },
  {
    id: 'auto-mode-inline-gate',
    name: 'Auto-mode unlock for third-party API (inline gate)',
    pattern: /if\((?:([\w$]+)!=="firstParty"&&(?:\1!=="anthropicAws"|![\w$]+\(\1\))[^;]*|[\w$]+\(\)&&\([\w$]+==="claude-opus-4-6"\|\|[\w$]+==="claude-sonnet-4-6"\|\|[\w$]+\.includes\("haiku"\)[^;]*?\))\)return!1;/g,
    replacer: () => '',
    sentinel: ['!=="firstParty"', '&&'],
    fallbacks: [{
      // 2.1.323 splits the provider/model denial and the Haiku denial into separate returns.
      pattern: /(function [\w$]+\(([\w$]+)\)\{let ([\w$]+)=[\w$]+\(\2\);if\([\w$]+\(\3\)\)return!1;let ([\w$]+)=[\w$]+\(\);)if\((\4&&\(\3==="claude-opus-4-6"\|\|\3==="claude-sonnet-4-6"\))\)return!1;(let ([\w$]+)=[\w$]+\(\)==="firstParty"&&[^;{}]+;)return(!\(\(\4\|\|\7\)&&\3\.includes\("haiku"\)&&\3!=="claude-haiku-5-5"\))\}/g,
      nodeType: ['FunctionDeclaration', 'FunctionExpression'],
      replacer: (m, prefix) => `${prefix}return!0}`,
    }, {
      // 2.1.328 merges provider variables and removes the Opus/Sonnet branch.
      pattern: /(function [\w$]+\(([\w$]+)\)\{let ([\w$]+)=[\w$]+\(\2\);if\([\w$]+\(\3\)\)return!1;let ([\w$]+)=[\w$]+\(\),([\w$]+)=[\w$]+\(\)==="firstParty"&&[^;{}]+;)return(!\(\(\4\|\|\5\)&&\3\.includes\("haiku"\)&&\3!=="claude-haiku-5-5"\))\}/g,
      nodeType: ['FunctionDeclaration', 'FunctionExpression'],
      replacer: (m, prefix) => `${prefix}return!0}`,
    }],
  },

  {
    id: 'macos-cmdv-image-paste',
    name: 'macOS Cmd+V image paste fallback to clipboard read',
    pattern: /if\(([\w$]+)\.length===0&&([\w$]+)\.length>0\)([\w$]+)\("input_image_drag","read_failed"\),([\w$]+)\.push\(\.\.\.\2\)/g,
    replacer: (m, L, R, at, D) =>
      `if(${L}.length===0&&${R}.length>0){${at}("input_image_drag","read_failed");if(d&&${D}.length===0){m();return}${D}.push(...${R})}`,
    // The old failure branch logs these adjacent arguments. Newer upstream code
    // has its own clipboard fallback and logs a conditional reason instead.
    sentinel: ['"input_image_drag","read_failed"'],
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
      pattern: /function\s+([\w$]+)\s*\(\s*\)\s*\{\s*if\s*\(\s*!([\w$]+)\(\s*(?:["']true["']|(?:process\.env|[\w$]+)\.EMBEDDED_SEARCH_TOOLS)\s*\)\s*\)\s*return\s*(?:!1|false)\s*;\s*if\s*\(\s*[\w$]+\(\s*\)\s*\)\s*return\s*(?:!1|false)\s*;\s*return\s+(?:process\.env|[\w$]+)\.CLAUDE_CODE_ENTRYPOINT\s*!==\s*["']local-agent["']\s*;?\s*\}/g,
      nodeType: ['FunctionDeclaration', 'FunctionExpression'],
    }],
  },

  {
    id: 'wiggly-dove',
    name: 'Block wiggly-dove Git/environment collection',
    ast: true,
  },

  {
    id: 'geo-stego-date',
    name: 'Neutralize geo-steganography in date string (qla)',
    ast: true,
  },
  {
    id: 'geo-detect-probe',
    name: 'Neutralize geo-detection probe (rdp)',
    ast: true,
  },
  {
    id: 'geo-apostrophe-stego',
    name: 'Neutralize apostrophe steganography (odp)',
    ast: true,
    optional: true,
  },

  {
    id: 'remove-cyber-risk',
    name: 'Remove CYBER_RISK_INSTRUCTION (unconditional)',
    coveredBy: ['pentest-prompt-rewrite'],
    pattern: /([\w$]+)="(IMPORTANT: Assist with authorized security testing[^"]*)"/g,
    replacer: (m, varName) => `${varName}=""`,
    sentinel: ['Assist with authorized security testing', 'IMPORTANT'],
  },
  {
    id: 'remove-url-restriction',
    name: 'Remove URL generation restriction',
    pattern: /(\n\$\{[\w$]+\})(\nIMPORTANT: You must NEVER generate or guess URLs[^.]*\. You may use URLs provided by the user in their messages or local files\.)/g,
    replacer: () => '',
    sentinel: ['NEVER generate or guess URLs', 'URLs provided by the user'],
  },
  {
    id: 'remove-cautious-actions',
    name: 'Remove cautious actions section',
    coveredBy: ['pentest-prompt-rewrite'],
    pattern: /function ([\w$]+)\(([\w$]*)\)\{(?:if\([\s\S]{1,200}?\)return`# Executing actions with care\n\n[\s\S]*?`;)?return`# Executing actions with care\n\n[\s\S]*?`\}/g,
    replacer: (m, fn, arg) => `function ${fn}(${arg}){return\`\`}`,
    sentinel: ['# Executing actions with care'],
  },
  {
    id: 'remove-not-logged-in',
    name: 'Remove "Not logged in" notice',
    ast: true,
    optional: true,
  },

  {
    id: 'attachment-filter-bypass',
    name: 'Attachment filter bypass',
    pattern: /([\w$]+)\(\)!=="ant"(&&[\w$]+\.has\([\w$]+\.attachment\.type\)|\)\{if\([\w$]+\.attachment\.type==="hook_additional_context")/g,
    replacer: (m) => m.replace(/([\w$]+)\(\)!=="ant"(&&|\))/, (cm, f, sep) => `!1${sep}`),
    optional: true,
  },
  {
    id: 'message-filter-legacy',
    name: 'Message list filter bypass (legacy ternary)',
    versions: '<2.1.214',
    pattern: /([\w$]+)\(\)!=="ant"\?([\w$]+)\(([\w$]+),([\w$]+)\(([\w$]+)\)\):([\w$]+)/g,
    replacer: (m, check, filter, messages, types, arg, original) => original,
    optional: true,
  },
  {
    id: 'message-filter-s8',
    name: 'Message list filter bypass (s_8 form)',
    pattern: /if\(([\w$]+)\(\)==="ant"\)return ([\w$]+);(?:if\([\w$]+\(\)&&[\w$]+\(\)\.project\?\.currentSessionCodeMode===!0\)return \2;)?let ([\w$]+)=([\w$]+) instanceof Set\?\4:(?:typeof \4==="function"\?\4\(\):)?([\w$]+)\(\4\);return ([\w$]+)\(\2,\3\)/g,
    replacer: (m, check, messages) => `return ${messages};`,
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
    id: 'auto-mode-rules-off',
    name: 'Skip the external auto-mode BLOCK rules pack',
    ast: true,
    optional: true,
  },
  {
    id: 'script-caps-off',
    name: 'Disable the script call limit',
    ast: true,
    optional: true,
  },
  {
    id: 'remote-settings-off',
    name: 'Ignore enterprise-managed remote settings',
    ast: true,
  },
  {
    id: 'tool-result-pairing-recovery',
    name: 'Recover orphaned tool results from message history',
    ast: true,
  },
];
