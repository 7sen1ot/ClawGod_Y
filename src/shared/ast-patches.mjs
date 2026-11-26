// @ts-check
/** @typedef {import('./patch-types.js').PatchNode} PatchNode */
/** @typedef {import('./patch-types.js').PatchScan} PatchScan */
import {
  AST_HELPERS, contains, containsOwn, createPatchCandidateFilter, createPatchContext,
  hasPatchAnchors, ownReturns, parsePatchSource, walk, walkScope,
} from './ast-helpers.mjs';

const { literal, propertyName, member, boolean, staticText, functionNode, declaredNames } = AST_HELPERS;
const thisMember = (node, name) => member(node, name) && node.object.type === 'ThisExpression';
const isUndefined = node => node?.type === 'UnaryExpression' && node.operator === 'void' &&
  literal(node.argument, 0);

export const AST_PATCH_IDS = [
  'user-type-ant', 'bun-standalone-executable', 'growthbook-env-overrides-graph', 'growthbook-config-overrides-graph',
  'computer-use-default', 'ultraplan',
  'geo-stego-date', 'remote-settings-off', 'wiggly-dove',
  'agent-teams-graph',
  'computer-use-gate-semantic', 'ultrareview-command',
  'auto-mode-rules-off', 'script-caps-off',
  'classifier-model', 'classifier-retries', 'classifier-timeout',
  'ultrareview-gate', 'geo-detect-probe', 'geo-apostrophe-stego', 'remove-not-logged-in',
  'tool-result-pairing-recovery',
  'session-project-paths', 'session-history-paths', 'session-state-paths', 'instruction-files-off', 'agents-md-off',
];

const anchors = ['external', 'isStandaloneExecutable', 'environmentOverridesParsed',
  'pixelValidation', 'ultraplan', 's date is ', 'getEnvironmentOverrides',
  'Remote settings:', 'remote-settings.json', 'tengu_wiggly_dove', 'tengu_amber_flint',
  'isEnabled', 'enabled', 'ultrareview', 'amber_flint', 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
  '[Tool result missing due to internal error]',
  'projects', 'history.jsonl', 'sessions', 'tasks', 'todos', 'teams', 'plans',
  'file-history', 'session-env', 'shell-snapshots', 'debug',
  'instructionFiles', 'claudeMdExcludes', 'sessionPath',
  '<permissions_template>', 'scriptCapsLatched', 'modelByMainModel', 'maxRetries', 'Math',
  'tengu_review_bughunter_config', 'Asia/Shanghai', 'Asia/Urumqi',
  '\u2019', '\u02bc', '\u02b9', 'Not logged in.'];
const patchMarker = id => `/*clawgod:${id}*/`;
function pairingScopeResolver(tree, sentinel) {
  const scopes = new WeakMap(), writes = [];
  const declare = (scope, pattern, value) => {
    for (const name of declaredNames(pattern)) {
      if (!scope.bindings.has(name)) scope.bindings.set(name, []);
      if (value !== null) scope.bindings.get(name).push(value);
    }
  };
  const resolve = (scope, name) => {
    for (; scope; scope = scope.parent) {
      if (scope.bindings.has(name)) return scope.bindings.get(name);
    }
  };
  const pending = [{ node: tree, scope: null }];
  while (pending.length) {
    let { node, scope } = pending.pop();
    const fn = functionNode(node);
    const cls = node.type === 'ClassDeclaration' || node.type === 'ClassExpression';
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') declare(scope, node.id);
    if (fn || cls || ['Program', 'BlockStatement', 'StaticBlock', 'CatchClause', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement'].includes(node.type)) {
      scope = { parent: scope, bindings: new Map(), vars: scope?.vars };
      if (fn || node.type === 'Program' || node.type === 'StaticBlock') scope.vars = scope;
      scopes.set(node, scope);
    }
    if (fn) {
      if (node.id) declare(scope, node.id);
      for (const param of node.params) declare(scope, param);
    }
    if (cls && node.id) declare(scope, node.id);
    if (node.type === 'CatchClause') declare(scope, node.param);
    if (node.type === 'ImportDeclaration') for (const specifier of node.specifiers) declare(scope, specifier.local);
    if (node.type === 'VariableDeclaration') {
      for (const declaration of node.declarations) {
        const value = declaration.id.type === 'Identifier' ? declaration.init : undefined;
        declare(node.kind === 'var' ? scope.vars : scope, declaration.id, value);
      }
    }
    if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
      writes.push({ scope, pattern: node.left ?? node.argument,
        value: node.operator === '=' && node.left.type === 'Identifier' ? node.right : undefined });
    }
    if (node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
      const patterns = node.left.type === 'VariableDeclaration' ? node.left.declarations.map(d => d.id) : [node.left];
      for (const pattern of patterns) writes.push({ scope, pattern, value: undefined });
    }
    for (const value of Object.values(node)) {
      if (value?.type) pending.push({ node: value, scope });
      else if (Array.isArray(value)) for (const child of value) if (child?.type) pending.push({ node: child, scope });
    }
  }
  for (const { scope, pattern, value } of writes) {
    for (const name of declaredNames(pattern)) resolve(scope, name)?.push(value);
  }
  return (expr, callback, owner) => {
    const history = owner.params[0].name;
    if (resolve(scopes.get(callback).parent, history) !== scopes.get(owner).bindings.get(history)) return false;
    if (literal(expr, sentinel)) return true;
    if (expr?.type !== 'Identifier') return false;
    const values = resolve(scopes.get(callback.body) ?? scopes.get(callback), expr.name);
    return !!values?.length && values.every(value => literal(value, sentinel));
  };
}


function hasRemoteSettingsContext(node) {
  return contains(node, child => {
    const text = staticText(child);
    const strings = text !== undefined ? [text]
      : child.type === 'TemplateLiteral' ? child.quasis.map(quasi => quasi.value.cooked ?? '') : [];
    return strings.some(value => value.includes('Remote settings:') || value.includes('remote-settings.json'));
  });
}

function scanSessionPaths(tree, code, context, results, edit) {
  const entries = new Set(['projects', 'history.jsonl', 'sessions', 'tasks', 'todos', 'teams',
    'plans', 'file-history', 'session-env', 'shell-snapshots', 'debug']);
  const isConfigRoot = node => {
    const value = context.resolve(node);
    if (value?.node?.type !== 'CallExpression' || value.node.arguments.length) return false;
    const target = value.context.resolve(value.node.callee);
    return target?.node && contains(target.node, child => literal(child, '.claude'));
  };
  walk(tree, node => {
    if (node.type === 'CallExpression' && member(node.callee, 'sessionPath') &&
        member(node.callee.object, '__clawgodHelpers')) {
      results['session-state-paths'].protected.push([node.start, node.end]);
      return false;
    }
    if (functionNode(node) && node.body.type === 'BlockStatement' &&
        containsOwn(node.body, child => member(child, 'claudeMdExcludes'))) {
      const returns = ownReturns(node.body);
      if (returns.length && returns.every(statement => functionNode(statement.argument))) {
        const id = 'instruction-files-off';
        results[id].present = true;
        for (const { argument } of returns) edit(id, argument,
          `(globalThis.__clawgodHelpers.instructionFileFilter(/*clawgod:${id}*/${code.slice(argument.start, argument.end)}))`);
      }
    }
    if (functionNode(node) && node.body.type === 'BlockStatement' &&
        containsOwn(node.body, child => member(child, 'instructionFiles')) &&
        containsOwn(node.body, child => member(child, 'projectInstructions')) &&
        containsOwn(node.body, child => literal(child, 'prompt.context'))) {
      const id = 'agents-md-off';
      results[id].present = true;
      edit(id, node.body, `{/*clawgod:${id}*/return;}`);
      return false;
    }
    if (node.type !== 'CallExpression' || node.arguments.length < 2 ||
        !(context.refers(node.callee, 'join') || context.refers(node.callee, 'resolve'))) return;
    const entry = staticText(node.arguments[1]);
    if (!entries.has(entry) && !isConfigRoot(node.arguments[0])) return;
    const id = entry === 'projects' ? 'session-project-paths' :
      entry === 'history.jsonl' ? 'session-history-paths' : 'session-state-paths';
    results[id].present = true;
    edit(id, node, `globalThis.__clawgodHelpers.sessionPath(/*clawgod:${id}*/${code.slice(node.start, node.end)})`);
    return false;
  });
}

/**
 * @param {string} code
 * @param {() => PatchNode} [readTree]
 * @param {() => ReturnType<typeof createPatchContext>} [readContext]
 * @returns {Record<string, PatchScan>}
 */
export function scanAstPatches(code, readTree = () => parsePatchSource(code), readContext) {
  /** @type {Record<string, PatchScan>} */
  const results = Object.fromEntries(AST_PATCH_IDS.map(id => [id, { matches: [], protected: [], present: false, patched: false }]));
  for (const id of AST_PATCH_IDS) if (code.includes(patchMarker(id))) results[id].patched = true;
  if (!hasPatchAnchors(code, anchors)) return results;
  const tree = readTree();
  const context = readContext ? readContext() : createPatchContext(tree, code);
  const isCandidate = createPatchCandidateFilter(tree, code, () => context);
  const teamCandidate = isCandidate(['CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS', 'agent-teams-graph']);
  const computerCandidate = isCandidate(['enabled', 'computer-use-gate-semantic']);
  const scriptCapsCandidate = isCandidate(['scriptCapsLatched', 'script-caps-off']);
  const classifierCandidate = isCandidate(['modelByMainModel', 'maxRetries', 'classifier-model', 'classifier-retries']);
  const timeoutCandidate = isCandidate(['Math', 'classifier-timeout']);
  const reviewCandidate = isCandidate(['enabled', 'tengu_review_bughunter_config', 'ultrareview-gate']);
  const geoProbeCandidate = isCandidate(['Asia/Shanghai', 'Asia/Urumqi', 'geo-detect-probe']);
  const apostropheCandidate = isCandidate(['\u2019', '\u02bc', '\u02b9', 'geo-apostrophe-stego']);
  const edit = (id, node, replacement, strategy = 'ast') => {
    results[id].matches.push({ start: node.start, end: node.end, replacement, strategy });
  };
  scanSessionPaths(tree, code, context, results, edit);
  const hasPatchMarker = (node, id) => {
    const marker = patchMarker(id);
    return code.slice(node.start, node.end).includes(marker) ||
      code.slice(Math.max(0, node.start - marker.length), node.start) === marker;
  };
  const alreadyPatched = (node, id) => {
    if (!hasPatchMarker(node, id)) return false;
    results[id].protected.push([node.start, node.end]);
    return true;
  };
  const injectReturn = (id, fn, value) => {
    if (!functionNode(fn) || fn.async || fn.generator) return false;
    if (alreadyPatched(fn, id)) return true;
    const body = fn.body;
    const original = code.slice(body.start, body.end);
    if (body.type !== 'BlockStatement') {
      edit(id, body, `(${patchMarker(id)}${value})`);
      return true;
    }
    let insertion = body.start + 1;
    for (const statement of body.body) {
      if (!statement.directive) break;
      insertion = statement.end;
    }
    const offset = insertion - body.start;
    // Retain the original statements so rescans can still identify the upstream function.
    edit(id, body, `${original.slice(0, offset)};${patchMarker(id)}if(!0)return ${value};${original.slice(offset)}`);
    return true;
  };
  const overridePredicate = (id, value, property) => {
    if (functionNode(value)) return injectReturn(id, value, '!0');
    const replace = (replacement, strategy) => edit(id, property.shorthand ? property : value,
      `${property.shorthand ? 'isEnabled:' : ''}${replacement}`, strategy);
    const resolved = context.resolve(value);
    if (!functionNode(resolved?.node)) {
      const dynamic = node => ['Identifier', 'MemberExpression', 'CallExpression', 'ChainExpression'].includes(node?.type);
      if (!dynamic(value) || resolved?.node && !dynamic(resolved.node)) return false;
      replace(`globalThis.__clawgodHelpers.enablePredicate(${patchMarker(id)}${code.slice(value.start, value.end)})`, 'runtime-hook');
      return true;
    }
    if (resolved.node.async || resolved.node.generator) return false;
    replace(`(${code.slice(value.start, value.end)},${patchMarker(id)}()=>!0)`);
    return true;
  };
  const returnCache = new WeakMap();
  const returnValues = fn => {
    let values = returnCache.get(fn);
    if (!values) {
      values = fn.body.type !== 'BlockStatement' ? [fn.body]
        : ownReturns(fn.body).map(statement => statement.argument).filter(Boolean);
      returnCache.set(fn, values);
    }
    return values;
  };
  const resolvedNode = node => context.resolve(node)?.node ?? node;
  const mathCall = (node, name) => {
    const value = resolvedNode(node);
    return value?.type === 'CallExpression' && member(value.callee, name) &&
      value.callee.object.name === 'Math' ? value : undefined;
  };
  const injectOverride = (id, fn, statements) => {
    if (alreadyPatched(fn, id)) { results[id].patched = true; return; }
    results[id].present = true;
    const body = fn.body, original = code.slice(body.start, body.end);
    const override = `{${patchMarker(id)}${statements}}`;
    if (body.type !== 'BlockStatement') {
      edit(id, body, `{${override}return (${original});}`);
      return;
    }
    let insertion = body.start + 1;
    for (const statement of body.body) {
      if (!statement.directive) break;
      insertion = statement.end;
    }
    const offset = insertion - body.start;
    edit(id, body, `${original.slice(0, offset)};${override}${original.slice(offset)}`);
  };

  const wigglyLiterals = new Set(), wigglyHandled = new Set(), wigglyCalls = [];
  let pairingHandled = false;
  const MISSING_SENTINEL = '[Tool result missing due to internal error]';
  const hasMissingSentinel = hasPatchAnchors(code, [MISSING_SENTINEL]);
  const resolvesToMissingSentinel = hasMissingSentinel ? pairingScopeResolver(tree, MISSING_SENTINEL) : () => false;
  walk(tree, (node, parent) => {
    if ((node.type === 'Literal' || node.type === 'TemplateLiteral') &&
        (/^Not logged in\. Run (?:\/[\w-]+|[\w ]+) to authenticate\.$/.test(staticText(node) ?? '') ||
          node.type === 'TemplateLiteral' && node.expressions.length > 0 &&
          node.quasis[0].value.cooked === 'Not logged in. Run ' && node.quasis.at(-1).value.cooked === ' to authenticate.')) {
      const id = 'remove-not-logged-in';
      results[id].present = true;
      edit(id, node, `${patchMarker(id)}""`);
      return false;
    }
    if (node.type === 'CallExpression' && (member(node.callee, 'replace') || member(node.callee, 'replaceAll')) &&
        node.arguments.length >= 2 && (context.text(node.arguments[0]) === '<permissions_template>' ||
          node.arguments[0].regex?.pattern === '<permissions_template>')) {
      const id = 'auto-mode-rules-off', replacement = node.arguments[1];
      if (alreadyPatched(replacement, id)) results[id].patched = true;
      else {
        results[id].present = true;
        edit(id, replacement, `(${patchMarker(id)}"")`);
      }
      return false;
    }
    if (scriptCapsCandidate && functionNode(node) && !node.async && !node.generator && node.body.type === 'BlockStatement') {
      const id = 'script-caps-off';
      if (node.body.body.length === 1 && node.body.body[0].type === 'ReturnStatement' &&
          node.body.body[0].argument == null && alreadyPatched(node.body, id)) {
        results[id].patched = true;
        return false;
      }
      const hasCaps = containsOwn(node.body, child => member(child, 'scriptCapsLatched'));
      if (hasCaps) {
        const guards = node.body.body.filter(statement => !statement.directive && statement.type !== 'EmptyStatement').slice(0, 2);
        const enabled = guards[0]?.test, latch = guards[1]?.test;
        const latched = latch?.type === 'SequenceExpression' ? latch.expressions.at(-1) : latch;
        const hasEntryGuards = guards.length === 2 && guards.every(statement =>
          statement.type === 'IfStatement' && !statement.alternate &&
          statement.consequent.type === 'ReturnStatement' && statement.consequent.argument == null) &&
          enabled?.type === 'UnaryExpression' && enabled.operator === '!' &&
          enabled.argument.type === 'CallExpression' && !enabled.argument.arguments.length &&
          latched?.type === 'UnaryExpression' && latched.operator === '!' && member(latched.argument, 'scriptCapsLatched');
        const hasLimit = containsOwn(node.body, child =>
          staticText(child)?.includes('Script call limit exceeded') ||
          child.type === 'TemplateLiteral' && child.quasis.some(quasi =>
            quasi.value.cooked?.includes('Script call limit exceeded')));
        if (hasLimit || hasEntryGuards) {
          results[id].present = true;
          edit(id, node.body, `{${patchMarker(id)}return;}`);
          return false;
        }
      }
    }
    if (functionNode(node) && !node.async && !node.generator) {
      // Command callbacks may already have been replaced by their containing descriptor.
      if (Object.values(results).some(result => result.matches.some(match =>
        match.start <= node.body.start && match.end >= node.body.end))) return false;
      const values = returnValues(node);
      if (classifierCandidate && !node.params.length) {
        const hasSource = source => values.some(value => containsOwn(resolvedNode(value), child =>
          child.type === 'ObjectExpression' && context.field(child, 'value') &&
          context.text(context.field(child, 'src')?.node) === source));
        if (hasSource('default')) {
          if (containsOwn(node.body, child => context.refers(child, 'modelByMainModel'))) {
            injectOverride('classifier-model', node,
              'let value=process.env.CLAWGOD_CLASSIFIER_MODEL?.trim();if(value)return{value,src:"default"};');
            return false;
          }
          if (hasSource('gb') && containsOwn(node.body, child => context.refers(child, 'maxRetries'))) {
            injectOverride('classifier-retries', node,
              'let value=process.env.CLAWGOD_CLASSIFIER_RETRIES?.trim();' +
              'if(value!==undefined&&value!==""&&Number.isInteger(+value)&&+value>=0)return{value:+value,src:"default"};');
            return false;
          }
        }
      }
      if (timeoutCandidate && node.params.length === 1 && node.params[0].type === 'Identifier' && values.length === 1) {
        const id = 'classifier-timeout';
        if (alreadyPatched(node, id)) { results[id].patched = true; return false; }
        const clamp = mathCall(values[0], 'min');
        const scaledStep = expression => {
          const product = resolvedNode(expression);
          if (product?.type !== 'BinaryExpression' || product.operator !== '*') return false;
          const step = literal(resolvedNode(product.left), 10000) ? product.right :
            literal(resolvedNode(product.right), 10000) ? product.left : undefined;
          const max = step && mathCall(step, 'max');
          if (!max || max.arguments.length !== 2) return false;
          const rounded = literal(resolvedNode(max.arguments[0]), 0) ? max.arguments[1] :
            literal(resolvedNode(max.arguments[1]), 0) ? max.arguments[0] : undefined;
          const ceil = rounded && mathCall(rounded, 'ceil');
          const quotient = ceil?.arguments.length === 1 && resolvedNode(ceil.arguments[0]);
          if (quotient?.type !== 'BinaryExpression' || quotient.operator !== '/' ||
              !literal(resolvedNode(quotient.right), 50000)) return false;
          const difference = resolvedNode(quotient.left);
          return difference?.type === 'BinaryExpression' && difference.operator === '-' &&
            context.same(difference.left, node.params[0]) && literal(resolvedNode(difference.right), 50000);
        };
        if (clamp?.arguments.some(argument => {
          const sum = resolvedNode(argument);
          return sum?.type === 'BinaryExpression' && sum.operator === '+' &&
            (scaledStep(sum.left) || scaledStep(sum.right));
        })) {
          results[id].present = true;
          edit(id, values[0], `((_result)=>{${patchMarker(id)}` +
            'let _floor=globalThis.__clawgodHelpers.classifierTimeoutFloor(process.env.CLAWGOD_CLASSIFIER_TIMEOUT_MS);' +
            `return _floor===null?_result:Math.max(_result,_floor)})(${code.slice(values[0].start, values[0].end)})`);
          return false;
        }
      }
      if (reviewCandidate && !node.params.length) {
        const reviewResult = (expression, budget = 16) => {
          if (!expression || budget <= 0) return false;
          const value = resolvedNode(expression);
          if (value.type === 'LogicalExpression') return reviewResult(value.left, budget - 1) || reviewResult(value.right, budget - 1);
          if (value.type === 'UnaryExpression' && value.operator === '!' &&
              value.argument.type === 'UnaryExpression' && value.argument.operator === '!') {
            return reviewResult(value.argument.argument, budget - 1);
          }
          if (value.type === 'BinaryExpression') {
            const expected = ['===', '=='].includes(value.operator) ? true :
              ['!==', '!='].includes(value.operator) ? false : undefined;
            return expected !== undefined &&
              (boolean(value.left, expected) && reviewResult(value.right, budget - 1) ||
               boolean(value.right, expected) && reviewResult(value.left, budget - 1));
          }
          if (value.type === 'ConditionalExpression' && boolean(value.consequent, true) && boolean(value.alternate, false)) {
            return reviewResult(value.test, budget - 1);
          }
          if (!member(value, 'enabled')) return false;
          const config = resolvedNode(value.object);
          if (config?.type !== 'CallExpression') return false;
          if (context.text(config.arguments[0]) === 'tengu_review_bughunter_config') return true;
          const getter = context.resolve(config.callee);
          return functionNode(getter?.node) && containsOwn(getter.node.body, call =>
            call.type === 'CallExpression' && getter.context.text(call.arguments[0]) === 'tengu_review_bughunter_config');
        };
        if (values.some(value => reviewResult(value)) && values.every(value =>
          boolean(resolvedNode(value), true) || boolean(resolvedNode(value), false) || reviewResult(value))) {
          const id = 'ultrareview-gate';
          if (alreadyPatched(node, id)) results[id].patched = true;
          else { results[id].present = true; injectReturn(id, node, '!0'); }
          return false;
        }
      }
      if (geoProbeCandidate && !node.params.length &&
          containsOwn(node.body, child => context.text(child) === 'Asia/Shanghai') &&
          containsOwn(node.body, child => context.text(child) === 'Asia/Urumqi') &&
          containsOwn(node.body, child => child.type === 'Property' && propertyName(child) === 'cnTZ')) {
        const id = 'geo-detect-probe';
        if (alreadyPatched(node, id)) results[id].patched = true;
        else { results[id].present = true; injectReturn(id, node, 'null'); }
        return false;
      }
      if (apostropheCandidate && node.params.length === 2 && values.length) {
        const outputs = new Set();
        const apostropheResult = (expression, budget = 16) => {
          if (!expression || budget <= 0) return false;
          const value = resolvedNode(expression), text = context.text(value);
          if (["'", '\u2019', '\u02bc', '\u02b9'].includes(text)) { outputs.add(text); return true; }
          if (value?.type === 'MemberExpression' && value.computed) {
            const table = resolvedNode(value.object);
            return table?.type === 'ArrayExpression' && table.elements.length === 4 &&
              table.elements.every(element => apostropheResult(element, budget - 1));
          }
          return value?.type === 'ConditionalExpression' &&
            apostropheResult(value.consequent, budget - 1) && apostropheResult(value.alternate, budget - 1);
        };
        if (values.every(value => apostropheResult(value)) && outputs.size === 4) {
          const id = 'geo-apostrophe-stego';
          if (alreadyPatched(node, id)) results[id].patched = true;
          else { results[id].present = true; injectReturn(id, node, '"\'"'); }
          return false;
        }
      }
    }
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      const members = new Map(node.body.body.map(entry => [propertyName(entry), entry]));
      const reader = members.get('getEnvironmentOverrides');
      const id = 'growthbook-env-overrides-graph';
      if (reader?.value?.body?.type === 'BlockStatement' &&
          members.has('deps') && members.has('hasEnvironmentOverride') && members.has('readConfigOverrides') &&
          members.has('environmentOverridesRaw') && members.has('environmentOverrides')) {
        const body = reader.value.body;
        if (code.slice(body.start, body.end).includes('/*clawgod:growthbook-env-overrides-graph*/')) {
          results[id].patched = true;
          results[id].protected.push([body.start, body.end]);
        } else if (body.body.length === 1 && body.body[0].type === 'ReturnStatement' && literal(body.body[0].argument, null)) {
          results[id].present = true;
          edit(id, body, '{/*clawgod:growthbook-env-overrides-graph*/' +
            'let _raw=this.deps.readEnvironmentOverrides?.();' +
            'if(_raw===this.environmentOverridesRaw)return this.environmentOverrides;' +
            'this.environmentOverridesRaw=_raw;this.environmentOverrides=null;' +
            'if(typeof _raw==="string"&&_raw.trim()){try{let _value=JSON.parse(_raw);' +
            'if(_value&&typeof _value==="object"&&!Array.isArray(_value))this.environmentOverrides=_value}catch{}}' +
            'return this.environmentOverrides}');
        }
        const config = members.get('readConfigOverrides'), configId = 'growthbook-config-overrides-graph';
        const configBody = config?.value?.body;
        if (configBody?.type === 'BlockStatement') {
          if (code.slice(configBody.start, configBody.end).includes('/*clawgod:growthbook-config-overrides-graph*/')) {
            results[configId].patched = true;
            results[configId].protected.push([configBody.start, configBody.end]);
          } else if (configBody.body.length === 1 && configBody.body[0].type === 'ReturnStatement' &&
              (configBody.body[0].argument == null || literal(configBody.body[0].argument, null))) {
            results[configId].present = true;
            edit(configId, configBody,
              '{/*clawgod:growthbook-config-overrides-graph*/return globalThis.__clawgodHelpers?.flagOverrides??null}');
          }
        }
      }
    }
    if (literal(node, 'tengu_wiggly_dove') && !literal(parent, 'tengu_wiggly_dove')) wigglyLiterals.add(node.start);
    if (node.type === 'CallExpression' && node.arguments.length >= 2 &&
        boolean(node.arguments[1], false) && context.text(node.arguments[0]) === 'tengu_wiggly_dove' &&
        (['ReturnStatement', 'VariableDeclarator', 'LogicalExpression', 'BinaryExpression'].includes(parent?.type) ||
          parent?.type === 'UnaryExpression' && parent.operator === '!' ||
          ['IfStatement', 'ConditionalExpression'].includes(parent?.type) && parent.test === node)) {
      wigglyCalls.push(node);
      const flag = context.resolve(node.arguments[0]);
      if (flag?.context === context) wigglyHandled.add(flag.node.start);
    }
    if (teamCandidate && functionNode(node) && node.params.length === 0) {
      const flagArguments = [];
      let teamEnv = false;
      walk(node.body, child => {
        if (child !== node.body && functionNode(child)) return false;
        if (child.type === 'CallExpression' && child.arguments.length) flagArguments.push(child.arguments[0]);
        if (context.refers(child, 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS')) teamEnv = true;
      });
      const booleanResult = (value, budget = 16) => {
        if (!value || budget <= 0) return false;
        if (boolean(value, true) || boolean(value, false)) return true;
        if (value.type === 'UnaryExpression' && value.operator === '!') return true;
        if (value.type === 'BinaryExpression' && ['===', '!==', '==', '!=', '<', '>', '<=', '>='].includes(value.operator)) return true;
        if (value.type === 'LogicalExpression') return booleanResult(value.right, budget - 1);
        if (value.type === 'ConditionalExpression') return booleanResult(value.consequent, budget - 1) && booleanResult(value.alternate, budget - 1);
        if (value.type === 'CallExpression' && context.text(value.arguments[0]) === 'tengu_amber_flint') {
          return boolean(value.arguments[1], true) || boolean(value.arguments[1], false);
        }
        return false;
      };
      const returns = teamEnv ? returnValues(node) : [];
      if (teamEnv && returns.length && returns.every(value => booleanResult(value)) &&
          flagArguments.some(argument => context.text(argument) === 'tengu_amber_flint')) {
        const id = 'agent-teams-graph';
        if (alreadyPatched(node, id)) results[id].patched = true;
        else { results[id].present = true; injectReturn(id, node, '!0'); }
      }
    }
    if (node.type === 'Program' || node.type === 'BlockStatement') {
      const flags = node.body.filter(s => s.type === 'VariableDeclaration')
        .flatMap(s => s.declarations).filter(d => literal(d.init, 'tengu_wiggly_dove'));
      for (const flag of flags) {
        const id = 'wiggly-dove';
        const candidates = node.body.filter(fn => {
          if (fn.type !== 'FunctionDeclaration' || fn.params.length || fn.async || fn.generator) return false;
          const statements = fn.body.body.filter(s => !s.directive && s.type !== 'EmptyStatement');
          const guards = statements.slice(0, -1);
          const last = statements.at(-1);
          if (!guards.length || !guards.every(s => s.type === 'IfStatement' && !s.alternate &&
              s.consequent.type === 'ReturnStatement' && boolean(s.consequent.argument, false)) ||
              last?.type !== 'ReturnStatement' || last.argument?.type !== 'CallExpression') return false;
          return flag.id.type === 'Identifier' && guards.some(s => {
            const call = s.test.type === 'UnaryExpression' && s.test.operator === '!' ? s.test.argument : null;
            return call?.type === 'CallExpression' && call.arguments.length === 2 &&
              call.arguments[0].type === 'Identifier' && call.arguments[0].name === flag.id.name &&
              boolean(call.arguments[1], false);
          });
        });
        if (!candidates.length) continue;
        wigglyHandled.add(flag.init.start);
        for (const candidate of candidates) {
          if (results[id].matches.some(match => match.start === candidate.body.start)) continue;
          if (alreadyPatched(candidate, id)) results[id].patched = true;
          else { results[id].present = true; injectReturn(id, candidate, '!1'); }
        }
      }
    }

    if (node.type === 'ObjectExpression') {
      const props = node.properties;
      const named = name => props.filter(p => p.type === 'Property' && propertyName(p) === name);
      const names = named('name');
      const command = names.length === 1 ? context.text(names[0].value) : undefined;
      const commandId = command === 'ultraplan' ? 'ultraplan' :
        command === 'ultrareview' && named('isEnabled').length ? 'ultrareview-command' : undefined;
      let hiddenFactoryInput = false;
      if (command === 'ultraplan' && !named('isEnabled').length &&
          parent?.type === 'CallExpression' && parent.arguments.length === 1 && parent.arguments[0] === node) {
        const factory = context.resolve(parent.callee), fn = factory?.node;
        if (functionNode(fn) && !fn.async && !fn.generator && fn.params.length === 1) {
          const returns = returnValues(fn);
          const descriptor = returns.length === 1 ? returns[0] : undefined;
          const name = factory.context.field(descriptor, 'name')?.node;
          // Subscription upsell factories take metadata, not a second command gate.
          hiddenFactoryInput = member(name, 'name') && factory.context.same(name.object, fn.params[0]) &&
            boolean(factory.context.field(descriptor, 'isHidden')?.node, true) &&
            !!factory.context.field(descriptor, 'isEnabled') && !!factory.context.field(descriptor, 'load');
        }
      }
      if (!hiddenFactoryInput && (commandId || names.some(p => literal(p.value, 'ultraplan'))) &&
          ['type', 'description', 'isEnabled', 'load', 'argumentHint', 'availability'].some(name => named(name).length)) {
        const id = commandId ?? 'ultraplan';
        const enabled = named('isEnabled');
        const patched = enabled.length === 1 && alreadyPatched(enabled[0].value, id);
        if (patched) results[id].patched = true;
        else results[id].present = true;
        if (names.length === 1 && enabled.length === 1 && enabled[0].kind === 'init' &&
            !patched &&
            !props.some(p => p.type === 'SpreadElement' || (p.computed && propertyName(p) === undefined))) {
          if (!overridePredicate(id, enabled[0].value, enabled[0])) results[id].skipped = (results[id].skipped ?? 0) + 1;
        } else if (!patched) results[id].skipped = (results[id].skipped ?? 0) + 1;
      }
      const enabled = named('enabled');
      if (named('pixelValidation').length === 1 && enabled.length === 1 &&
          enabled[0].kind === 'init' &&
          !props.some(p => p.type === 'SpreadElement' || (p.computed && propertyName(p) === undefined))) {
        const id = 'computer-use-default', value = enabled[0].value;
        if (alreadyPatched(value, id)) results[id].patched = true;
        else {
          results[id].present = true;
          if (['Identifier', 'CallExpression', 'MemberExpression', 'LogicalExpression', 'ConditionalExpression'].includes(value.type) ||
              boolean(value, false) || boolean(value, true)) {
            edit(id, value, `(${patchMarker(id)}!0)`);
          } else results[id].skipped = (results[id].skipped ?? 0) + 1;
        }
      }
    }

    if (computerCandidate && functionNode(node) && !node.params.length && !node.async && !node.generator) {
      const id = 'computer-use-gate-semantic';
      let computerConfig = false, inlineConfig = false, candidate = false, mergedConfig = false;
      const enabledSites = [];
      const enabledResult = expression => {
        if (expression.type === 'ChainExpression') return enabledResult(expression.expression);
        if (expression.type === 'LogicalExpression' && expression.operator === '&&') return enabledResult(expression.right);
        if (expression.type === 'BinaryExpression') {
          const expected = ['===', '=='].includes(expression.operator) ? true :
            ['!==', '!='].includes(expression.operator) ? false : undefined;
          if (expected !== undefined) {
            if (boolean(expression.right, expected)) return enabledResult(expression.left);
            if (boolean(expression.left, expected)) return enabledResult(expression.right);
          }
        }
        return member(expression, 'enabled') ? expression : undefined;
      };
      if (alreadyPatched(node, id)) results[id].patched = true;
      else for (const value of returnValues(node)) {
        const child = enabledResult(value);
        if (!child) continue;
        let config = context.resolve(child.object);
        if (config?.node?.type === 'ObjectExpression' && config.node.properties.length === 2 &&
            config.node.properties.every(property => property.type === 'SpreadElement')) {
          const [defaults, override] = config.node.properties.map(property => property.argument);
          if (override.type === 'CallExpression' && override.arguments.length === 2 &&
              config.context.text(override.arguments[0]) === 'tengu_malort_pedway' &&
              config.context.same(defaults, override.arguments[1])) {
            config = config.context.resolve(defaults);
            mergedConfig = true;
          }
        }
        if (config?.context?.field(config.node, 'pixelValidation') && config.context.field(config.node, 'enabled')) {
          results[id].present = true;
          candidate = true;
          enabledSites.push(child);
          if (config.context !== context || config.node.start < node.start || config.node.end > node.end) computerConfig = true;
          else inlineConfig = true;
        }
      }
      if (computerConfig && !inlineConfig) {
        // Keep the organization/HIPAA guards around the merged configuration's enabled flag.
        if (mergedConfig) {
          for (const child of enabledSites) edit(id, child, `(${patchMarker(id)}!0)`);
        } else injectReturn(id, node, '!0');
      } else if (candidate) results[id].skipped = (results[id].skipped ?? 0) + 1;
    }

    if (functionNode(node) && node.params.length === 1 &&
        node.params[0].type === 'Identifier' && !node.async && !node.generator) {
      const id = 'geo-stego-date';
      const partsOf = (value, budget = 32) => {
        if (budget <= 0) return [value];
        if (value.type === 'TemplateLiteral') return value.quasis.flatMap((quasi, index) =>
          index < value.expressions.length ? [quasi.value.cooked ?? '', ...partsOf(value.expressions[index], budget - 1)] : [quasi.value.cooked ?? '']);
        if (value.type === 'BinaryExpression' && value.operator === '+') return [...partsOf(value.left, budget - 1), ...partsOf(value.right, budget - 1)];
        const text = context.text(value);
        return [text === undefined ? value : text];
      };
      const fromParameter = (value, budget = 16) => {
        if (!value || budget <= 0) return;
        if (context.same(value, node.params[0])) return node.params[0].name;
        if (value.type === 'MemberExpression') {
          const object = fromParameter(value.object, budget - 1);
          const key = value.computed ? context.text(value.property) : value.property.name;
          if (object && key !== undefined) return `${object}[${JSON.stringify(key)}]`;
        }
      };
      let candidate = false, rewritten = false;
      if (alreadyPatched(node, id)) results[id].patched = true;
      else for (const date of returnValues(node)) {
        const parts = [];
        for (const part of partsOf(date)) {
          if (typeof part === 'string' && typeof parts.at(-1) === 'string') parts[parts.length - 1] += part;
          else if (part !== '') parts.push(part);
        }
        if (parts.length !== 5 || parts[0] !== 'Today' || parts[2] !== 's date is ' || parts[4] !== '.') continue;
        results[id].present = true;
        candidate = true;
        const formatted = context.resolve(parts[3]);
        if (formatted?.context !== context || formatted.node.type !== 'ConditionalExpression') continue;
        const { consequent, alternate } = formatted.node;
        let raw;
        for (const [candidate, original] of [[consequent, alternate], [alternate, consequent]]) {
          const call = context.resolve(candidate)?.node;
          if (call?.type !== 'CallExpression' || call.arguments.length !== 2) continue;
          const separator = member(call.callee, 'replaceAll') && context.text(call.arguments[0]) === '-' ||
            member(call.callee, 'replace') && call.arguments[0].regex?.pattern === '-' && call.arguments[0].regex.flags === 'g';
          if (separator && context.text(call.arguments[1]) === '/' && context.same(call.callee.object, original)) raw = fromParameter(original);
        }
        if (raw) { rewritten = injectReturn(id, node, `\`Today's date is \${${raw}}.\``); break; }
      }
      if (candidate && !rewritten) results[id].skipped = (results[id].skipped ?? 0) + 1;
    }

    if (functionNode(node) && node.params.length === 0 && !node.async && !node.generator) {
      const statements = node.body.type === 'BlockStatement'
        ? node.body.body.filter(statement => !statement.directive && statement.type !== 'EmptyStatement') : [];
      const value = node.body.type !== 'BlockStatement' ? node.body :
        statements.length === 1 && statements[0].type === 'ReturnStatement' ? statements[0].argument : undefined;
      if (literal(value, 'external')) edit('user-type-ant', value, '"ant"');
      const standaloneMember = expr => member(expr, 'isStandaloneExecutable') && expr.object.name === 'Bun';
      const standalone = expr => standaloneMember(expr) ||
        expr?.type === 'BinaryExpression' && ['===', '=='].includes(expr.operator) &&
          (standaloneMember(expr.left) && boolean(expr.right, true) ||
           standaloneMember(expr.right) && boolean(expr.left, true));
      const bunType = expr => expr?.type === 'UnaryExpression' && expr.operator === 'typeof' && expr.argument.name === 'Bun';
      const typeofBun = expr => expr?.type === 'BinaryExpression' &&
        (expr.operator === '<' && bunType(expr.left) && literal(expr.right, 'u') ||
         expr.operator === '>' && bunType(expr.right) && literal(expr.left, 'u') ||
         ['!==', '!='].includes(expr.operator) &&
           (bunType(expr.left) && literal(expr.right, 'undefined') || bunType(expr.right) && literal(expr.left, 'undefined')));
      if (standalone(value) || (value?.type === 'LogicalExpression' && value.operator === '&&' &&
          typeofBun(value.left) && standalone(value.right))) edit('bun-standalone-executable', value, '!0');
    }

    if (functionNode(node) && node.params.length === 0 && node.body.type === 'BlockStatement' &&
        !node.async && !node.generator) {
      const statements = node.body.body;
      const cached = statements.find(statement => statement.type === 'VariableDeclaration' &&
        statement.declarations.length === 1 && statement.declarations[0].id.type === 'Identifier' &&
        statement.declarations[0].init?.type === 'CallExpression');
      const cachedName = cached?.declarations[0].id.name;
      const cachedReturn = cachedName && statements.find(statement =>
        statement.type === 'IfStatement' && statement.test.type === 'BinaryExpression' &&
        statement.test.operator === '!==' && statement.test.left.type === 'Identifier' &&
        statement.test.left.name === cachedName && isUndefined(statement.test.right) &&
        statement.consequent.type === 'ReturnStatement' && statement.consequent.argument?.type === 'Identifier' &&
        statement.consequent.argument.name === cachedName);
      const eligibility = statements.filter(statement => statement.type === 'VariableDeclaration')
        .flatMap(statement => statement.declarations).find(declaration => declaration.id.type === 'ObjectPattern' &&
        declaration.init?.type === 'CallExpression' &&
        declaration.init.callee.type === 'Identifier' &&
        declaration.id.properties.some(property => property.type === 'Property' &&
          propertyName(property) === 'eligible'));
      // Newer builds pass the eligibility reader through a credential-scope wrapper.
      const helpers = eligibility && [eligibility.init.callee, ...eligibility.init.arguments]
        .flatMap(value => {
          const helper = context.resolve(value)?.node;
          if (!functionNode(helper)) return [];
          const returned = helper.body.type === 'BlockStatement' && helper.body.body.length === 1 &&
            helper.body.body[0].type === 'ReturnStatement' ? helper.body.body[0].argument : helper.body;
          // 2.1.332 forwards the reader through another single-return wrapper.
          return [helper, ...(returned?.type === 'CallExpression' ? returned.arguments
            .map(argument => context.resolve(argument)?.node) : [])];
        });
      if (helpers?.some(helper => functionNode(helper) && hasRemoteSettingsContext(helper))) {
        const id = 'remote-settings-off';
        if (!cachedReturn) results[id].present = true;
        else {
          results[id].present = false;
          if (alreadyPatched(node, id)) results[id].patched = true;
          else injectReturn(id, node, '!1');
        }
      }
    }

    if (functionNode(node) &&
        node.params.length > 0 && node.params[0].type === 'Identifier') {
      const historyParam = node.params[0].name;
      let isHistoryArray = false;
      walkScope(node.body, inner => {
        if (inner.type === 'MemberExpression' && inner.object?.type === 'Identifier' && inner.object.name === historyParam) {
          if (inner.property?.name === 'length' || inner.computed) isHistoryArray = true;
        }
      });
      if (isHistoryArray) {
        const id = 'tool-result-pairing-recovery';
        if (hasPatchMarker(node, id)) {
          results[id].patched = true;
          pairingHandled = true;
        } else {
          walkScope(node.body, inner => {
            if (inner.type === 'CallExpression' && member(inner.callee, 'map') && inner.arguments.length >= 1) {
              const cb = inner.arguments[0];
              if (!['ArrowFunctionExpression', 'FunctionExpression'].includes(cb?.type) || cb.async || cb.generator) return;
              const idParam = cb.params[0];
              if (cb.params.length !== 1 || idParam?.type !== 'Identifier') return;
              const returnObj = cb.body.type === 'ObjectExpression' ? cb.body
                : cb.body.type === 'BlockStatement' && cb.body.body.length === 1 && cb.body.body[0].type === 'ReturnStatement' ? cb.body.body[0].argument
                : null;
              if (returnObj?.type !== 'ObjectExpression') return;
              const props = returnObj.properties.filter(p => p.type === 'Property');
              if (props.length !== 4 || returnObj.properties.length !== 4 ||
                  props.some(p => p.kind !== 'init' || p.method || (p.computed && propertyName(p) === undefined)) ||
                  new Set(props.map(propertyName)).size !== 4) return;
              const hasType = props.some(p => propertyName(p) === 'type' && literal(p.value, 'tool_result'));
              const hasToolUseId = props.some(p => propertyName(p) === 'tool_use_id' && p.value?.type === 'Identifier' && p.value.name === idParam.name);
              const hasIsError = props.some(p => propertyName(p) === 'is_error' && boolean(p.value, true));
              const contentProp = props.find(p => propertyName(p) === 'content');
              if (hasType && hasToolUseId && hasIsError && contentProp && resolvesToMissingSentinel(contentProp.value, cb, node)) {
                const usedNames = new Set();
                walk(node, n => {
                  if (n.type === 'Identifier') usedNames.add(n.name);
                });
                const freshId = base => {
                  let name = base;
                  let counter = 1;
                  while (usedNames.has(name)) {
                    name = `${base}${counter++}`;
                  }
                  usedNames.add(name);
                  return name;
                };
                const pVar = freshId('_p');
                const mVar = freshId('_m');
                const bVar = freshId('_b');
                const idVar = freshId('_id');
                const contentExpr = code.slice(contentProp.value.start, contentProp.value.end);
                const replacement =
                  `(${idVar})=>{${patchMarker(id)}` +
                  `let ${pVar};` +
                  `for(let ${mVar} of ${historyParam}){` +
                  `if(${mVar}?.message?.content&&Array.isArray(${mVar}.message.content)){` +
                  `for(let ${bVar} of ${mVar}.message.content){` +
                  `if(${bVar}?.type==="tool_result"&&${bVar}.tool_use_id===${idVar}&&${bVar}.content!==${contentExpr}){` +
                  `${pVar}=${bVar};break;` +
                  `}` +
                  `}` +
                  `}` +
                  `if(${pVar})break;` +
                  `}` +
                  `return ${pVar}?{...${pVar}}:{type:"tool_result",tool_use_id:${idVar},content:${contentExpr},is_error:!0}` +
                  `}`;
                edit(id, cb, replacement);
                pairingHandled = true;
              }
            }
          });
        }
      }
    }

    if ((node.type === 'MethodDefinition' || node.type === 'Property') &&
        propertyName(node) === 'getEnvironmentOverrides' && node.value?.body?.type === 'BlockStatement') {
      const statements = node.value.body.body;
      for (let i = 0; i < statements.length - 1; i++) {
        const statement = statements[i];
        const values = statement.argument?.expressions;
        const next = statements[i + 1];
        if (statement.type !== 'ReturnStatement' || values?.length !== 2) continue;
        const [assignment, result] = values;
        if (assignment.type !== 'AssignmentExpression' || assignment.operator !== '=' ||
            !thisMember(assignment.left, 'environmentOverridesParsed') || !boolean(assignment.right, true) ||
            !thisMember(result, 'environmentOverrides') || next.type !== 'VariableDeclaration') continue;
        const readsOverrides = next.declarations.some(d => d.init?.type === 'CallExpression' &&
          member(d.init.callee, 'readEnvironmentOverrides') && thisMember(d.init.callee.object, 'deps'));
        if (readsOverrides) edit('growthbook-env-overrides-graph', statement,
          `${code.slice(assignment.start, assignment.end)};`);
      }
    }
  });
  for (const call of wigglyCalls) {
    const id = 'wiggly-dove';
    if (results[id].matches.some(match => match.start <= call.start && match.end >= call.end) ||
        results[id].protected.some(([start, end]) => start <= call.start && end >= call.end)) continue;
    results[id].present = true;
    edit(id, call, `(${patchMarker(id)}!1)`);
  }
  const unhandledWiggly = [...wigglyLiterals].filter(start => !wigglyHandled.has(start));
  if (unhandledWiggly.length) {
    results['wiggly-dove'].present = true;
    results['wiggly-dove'].skipped = unhandledWiggly.length;
  }
  if (hasMissingSentinel && !pairingHandled) {
    results['tool-result-pairing-recovery'].present = true;
    results['tool-result-pairing-recovery'].matches = [];
  }
  return results;
}
