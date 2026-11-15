import { parse } from './acorn.mjs';

function staticText(node, budget = 32) {
  if (!node || budget <= 0) return;
  if (node.type === 'Literal') return typeof node.value === 'string' ? node.value : undefined;
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = staticText(node.left, budget - 1), right = staticText(node.right, budget - 1);
    if (left !== undefined && right !== undefined) return left + right;
  }
  if (node.type === 'TemplateLiteral') {
    let text = node.quasis[0].value.cooked;
    if (typeof text !== 'string') return;
    for (let i = 0; i < node.expressions.length; i++) {
      const value = staticText(node.expressions[i], budget - 1), tail = node.quasis[i + 1].value.cooked;
      if (value === undefined || typeof tail !== 'string') return;
      text += value + tail;
    }
    return text;
  }
}
const literal = (node, value) => typeof value === 'string' ? staticText(node) === value
  : node?.type === 'Literal' && node.value === value;
const propertyName = node => node.computed
  ? (staticText(node.key) ?? (node.key?.type === 'Literal' ? node.key.value : undefined))
  : (node.key?.name ?? node.key?.value);
const member = (node, name) => node?.type === 'MemberExpression' &&
  (node.computed ? literal(node.property, name) : node.property.name === name);
const boolean = (node, value, budget = 32) => budget > 0 && (literal(node, value) ||
  (node?.type === 'UnaryExpression' && node.operator === '!' &&
    (node.argument.type === 'Literal' ? !node.argument.value === value : boolean(node.argument, !value, budget - 1))));
const firstPromptText = node => staticText(node) ?? (node?.type === 'BinaryExpression' && node.operator === '+'
  ? firstPromptText(node.left) || firstPromptText(node.right)
  : node?.type === 'TemplateLiteral' ? node.quasis[0].value.cooked : undefined);

const functionNode = node => ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node?.type);
const declaredNames = node => !node ? [] : node.type === 'Identifier' ? [node.name]
  : node.type === 'RestElement' ? declaredNames(node.argument)
  : node.type === 'AssignmentPattern' ? declaredNames(node.left)
  : node.type === 'ArrayPattern' ? node.elements.flatMap(declaredNames)
  : node.type === 'ObjectPattern' ? node.properties.flatMap(property =>
    declaredNames(property.type === 'RestElement' ? property.argument : property.value)) : [];

export const AST_HELPERS = { literal, propertyName, member, boolean, staticText, firstPromptText, functionNode, declaredNames };

const sourceCache = new Map();
const scopeCache = new WeakMap();
const noImports = () => undefined;
let cachedSourceBytes = 0;

export function releasePatchSource(code) {
  const record = sourceCache.get(code);
  if (!record) return;
  cachedSourceBytes -= code.length * 2;
  sourceCache.delete(code);
  if (record.tree) scopeCache.delete(record.tree);
}

function sourceRecord(code) {
  let record = sourceCache.get(code);
  if (record) sourceCache.delete(code);
  else {
    record = {};
    cachedSourceBytes += code.length * 2;
  }
  sourceCache.set(code, record);
  // ASTs, indexes and file contexts share one LRU; the byte budget measures source text.
  while (sourceCache.size > 1 && (cachedSourceBytes > 32 * 1024 * 1024 || sourceCache.size > 256)) {
    releasePatchSource(sourceCache.keys().next().value);
  }
  return record;
}

const includesAnchors = (source, anchors) => {
  const matches = token => token instanceof RegExp ? source.search(token) !== -1 : source.includes(token);
  return anchors.some(group => Array.isArray(group) ? group.every(matches) : matches(group));
};

export function hasPatchAnchors(code, anchors) {
  if (includesAnchors(code, anchors)) return true;
  // Normalize only the prefilter; edits still use original AST ranges.
  const record = sourceRecord(code);
  const normalized = record.normalized ??= code.replace(/\\(?:u\{([\da-f]+)\}|u([\da-f]{4})|x([\da-f]{2}))/gi,
    (match, point, unit, byte) => {
      const value = parseInt(point ?? unit ?? byte, 16);
      return value <= 0x10ffff ? String.fromCodePoint(value) : match;
    }).replace(/(["'`])\s*\+\s*(["'`])/g, '');
  return includesAnchors(normalized, anchors);
}

// One lazy summary per scan; no source or AST is retained beyond its caller.
export function createPatchCandidateFilter(tree, code, readContext = () => createPatchContext(tree, code)) {
  let text, constructed, resolvedText, unresolved = false;
  return (anchors, resolveAliases = false) => {
    if (hasPatchAnchors(code, anchors)) return true;
    if (text === undefined) {
      const parts = new Set();
      constructed = [];
      walk(tree, node => {
        if (node.type === 'Identifier') parts.add(node.name);
        if (node.type === 'Literal' && typeof node.value === 'string') parts.add(node.value);
        if (node.type !== 'TemplateLiteral' && !(node.type === 'BinaryExpression' && node.operator === '+')) return;
        const value = staticText(node);
        if (value !== undefined) parts.add(value);
        else constructed.push(node);
        if (node.type === 'TemplateLiteral') for (const quasi of node.quasis) {
          if (typeof quasi.value.cooked === 'string') parts.add(quasi.value.cooked);
        }
      });
      text = [...parts].join('\n');
    }
    if (includesAnchors(text, anchors)) return true;
    if (!resolveAliases || !constructed.length) return false;
    if (resolvedText === undefined) {
      const parts = [], context = readContext();
      for (const node of constructed) {
        const value = context.text(node);
        if (value === undefined) unresolved = true;
        else parts.push(value);
      }
      resolvedText = parts.join('\n');
    }
    return unresolved || includesAnchors(resolvedText, anchors);
  };
}

// Cached trees are read-only; rewriting source selects a fresh cache record.
export const parsePatchSource = code => sourceRecord(code).tree ??= parse(code, {
  ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true,
  allowReturnOutsideFunction: true, allowImportExportEverywhere: true,
});

export function getPatchNodeIndex(code) {
  const record = sourceRecord(code);
  if (!record.nodes) {
    const nodes = new Map();
    walk(parsePatchSource(code), node => {
      const at = nodes.get(node.start) ?? [];
      at.push(node);
      nodes.set(node.start, at);
    });
    record.nodes = nodes;
  }
  return record.nodes;
}

export function getCachedPatchContext(code, name, loadImport) {
  const record = sourceRecord(code);
  const contexts = record.contexts ??= new Map();
  if (!contexts.has(name)) contexts.set(name, createPatchContext(parsePatchSource(code), code, loadImport));
  return contexts.get(name);
}

export function releasePatchContexts() {
  for (const record of sourceCache.values()) {
    delete record.contexts;
    if (record.tree) scopeCache.delete(record.tree);
  }
}

export function walk(root, visit) {
  const pending = [root, null];
  while (pending.length) {
    const parent = pending.pop(), node = pending.pop();
    if (visit(node, parent) === false) continue;
    for (const value of Object.values(node)) {
      if (value?.type) pending.push(value, node);
      else if (Array.isArray(value)) {
        for (const child of value) if (child?.type) pending.push(child, node);
      }
    }
  }
}

export function contains(root, predicate) {
  let found = false;
  walk(root, node => {
    if (found) return false;
    if (predicate(node)) { found = true; return false; }
  });
  return found;
}

export function containsOwn(root, predicate) {
  let found = false;
  walk(root, node => {
    if (found || node !== root && functionNode(node)) return false;
    if (predicate(node)) { found = true; return false; }
  });
  return found;
}

export function walkScope(root, visit) {
  walk(root, node => {
    visit(node);
    if (functionNode(node)) return false;
  });
}

export function ownReturns(body) {
  const returns = [];
  walkScope(body, node => {
    if (node.type === 'ReturnStatement') returns.push(node);
  });
  return returns;
}

function patchScope(tree, loadImport) {
  // Different import resolvers need separate binding identities for cycle detection.
  let contexts = scopeCache.get(tree);
  if (!contexts) scopeCache.set(tree, contexts = new WeakMap());
  const cached = contexts.get(loadImport);
  if (cached) return cached;
  const scopes = new WeakMap(), root = { parent: null, function: true, bindings: new Map() };
  const writes = [], exports = new Map();
  let commonJS;
  const bind = (scope, name, value) => {
    if (scope.bindings.has(name)) scope.bindings.set(name, { unknown: true });
    else scope.bindings.set(name, value);
  };
  const lookup = node => {
    for (let scope = scopes.get(node); scope; scope = scope.parent) {
      if (scope.bindings.has(node.name)) return scope.bindings.get(node.name);
    }
  };
  walk(tree, (node, parent) => {
    let scope = parent ? scopes.get(parent) : root;
    if (node.type === 'FunctionDeclaration' && node.id) bind(scope, node.id.name, { node });
    if (node.type === 'ClassDeclaration' && node.id) bind(scope, node.id.name, { unknown: true });
    if (functionNode(node)) {
      scope = { parent: scope, function: true, bindings: new Map() };
      if (node.type === 'FunctionExpression' && node.id) bind(scope, node.id.name, { node });
      for (const param of node.params) for (const name of declaredNames(param)) bind(scope, name, { unknown: true });
    } else if (['BlockStatement', 'CatchClause', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement', 'ClassExpression'].includes(node.type)) {
      scope = { parent: scope, bindings: new Map() };
      for (const name of declaredNames(node.param)) bind(scope, name, { unknown: true });
      if (node.type === 'ClassExpression' && node.id) bind(scope, node.id.name, { unknown: true });
    }
    scopes.set(node, scope);
    if (node.type === 'VariableDeclarator') {
      let target = scope;
      if (parent.kind === 'var') while (!target.function) target = target.parent;
      for (const name of declaredNames(node.id)) {
        const property = node.id.type === 'ObjectPattern' && node.id.properties.find(entry =>
          entry.type === 'Property' && entry.value.type === 'Identifier' && entry.value.name === name);
        const key = property && propertyName(property);
        bind(target, name, node.id.type === 'Identifier' ? { node: node.init } :
          typeof key === 'string' ? { object: node.init, key } : { unknown: true });
      }
    }
    if (node.type === 'ImportDeclaration') for (const specifier of node.specifiers) {
      bind(scope, specifier.local.name, { source: node.source.value,
        imported: specifier.type === 'ImportNamespaceSpecifier' ? '*' :
          specifier.type === 'ImportDefaultSpecifier' ? 'default' : specifier.imported.name ?? specifier.imported.value });
    }
    if (node.type === 'AssignmentExpression') {
      writes.push(node.left);
      if (member(node.left, 'exports') && node.left.object.name === 'module') commonJS = { left: node.left, right: node.right };
    }
    if (node.type === 'UpdateExpression') writes.push(node.argument);
  });
  for (const target of writes) {
    let node = target;
    while (node?.type === 'MemberExpression') node = node.object;
    if (node?.type === 'Identifier') { const binding = lookup(node); if (binding) { binding.unknown = true; binding.mutated = true; } }
    else walk(target, child => {
      if (child.type === 'Identifier') { const binding = lookup(child); if (binding) { binding.unknown = true; binding.mutated = true; } }
    });
  }
  commonJS = commonJS && !lookup(commonJS.left.object) ? commonJS.right : undefined;
  for (const statement of tree.body) {
    if (statement.type === 'ExportDefaultDeclaration') exports.set('default', { node: statement.declaration });
    if (statement.type !== 'ExportNamedDeclaration') continue;
    if (statement.declaration?.id) exports.set(statement.declaration.id.name, { node: statement.declaration.id });
    for (const declaration of statement.declaration?.declarations ?? []) {
      if (declaration.id.type === 'Identifier') exports.set(declaration.id.name, { node: declaration.id });
    }
    for (const specifier of statement.specifiers) exports.set(specifier.exported.name ?? specifier.exported.value,
      statement.source ? { source: statement.source.value, imported: specifier.local.name ?? specifier.local.value } : { node: specifier.local });
  }
  const scope = { lookup, exports, commonJS };
  contexts.set(loadImport, scope);
  return scope;
}

export function createPatchContext(tree, code, loadImport = noImports) {
  const { lookup, exports, commonJS } = patchScope(tree, loadImport);
  const context = {
    code,
    refers(node, name, budget = 32) {
      if (!node || budget <= 0) return false;
      if (member(node, name)) return true;
      if (node.type !== 'Identifier') return false;
      const binding = lookup(node);
      if (!binding || binding.unknown) return false;
      return binding.imported === name || binding.key === name || context.refers(binding.node, name, budget - 1);
    },
    exported(name, seen, budget) {
      if (budget <= 0) return;
      const entry = exports.get(name);
      if (entry?.source) return loadImport(entry.source)?.exported(entry.imported, seen, budget - 1);
      if (entry) return context.resolve(entry.node, seen, budget - 1);
      const value = commonJS && context.resolve(commonJS, seen, budget - 1);
      const field = value?.context?.field(value.node, name, seen, budget - 1);
      return field?.context.resolve(field.node, seen, budget - 1);
    },
    same(left, right, budget = 32) {
      if (!left || !right || budget <= 0) return false;
      if (left.type === 'Identifier' && right.type === 'Identifier') {
        const a = lookup(left), b = lookup(right);
        if (a && a === b && !a.mutated) return true;
      }
      if (left.type === 'Identifier') {
        const binding = lookup(left);
        if (binding && !binding.unknown && binding.node) return context.same(binding.node, right, budget - 1);
      }
      if (right.type === 'Identifier') {
        const binding = lookup(right);
        if (binding && !binding.unknown && binding.node) return context.same(left, binding.node, budget - 1);
      }
      if (left.type === 'MemberExpression' && right.type === 'MemberExpression') {
        const key = value => value.computed ? context.text(value.property) : value.property.name;
        return key(left) !== undefined && key(left) === key(right) && context.same(left.object, right.object, budget - 1);
      }
      return false;
    },
    field(node, name, seen = new Set(), budget = 32) {
      if (budget <= 0 || node?.type !== 'ObjectExpression' || node.properties.some(property =>
        property.type !== 'Property' || property.computed && context.text(property.key, seen, budget - 1) === undefined)) return;
      const properties = node.properties.filter(property =>
        (property.computed ? context.text(property.key, seen, budget - 1) : propertyName(property)) === name);
      if (properties.length !== 1 || properties[0].kind !== 'init') return;
      return { node: properties[0].value, context };
    },
    text(node, seen = new Set(), budget = 32) {
      if (budget <= 0) return;
      const value = context.resolve(node, seen, budget - 1);
      if (!value?.node) return;
      const direct = staticText(value.node);
      if (direct !== undefined) return direct;
      if (value.node.type === 'BinaryExpression' && value.node.operator === '+') {
        const left = value.context.text(value.node.left, new Set(seen), budget - 1);
        const right = value.context.text(value.node.right, new Set(seen), budget - 1);
        if (left !== undefined && right !== undefined) return left + right;
      }
      if (value.node.type === 'TemplateLiteral') {
        let text = value.node.quasis[0].value.cooked;
        if (typeof text !== 'string') return;
        for (let i = 0; i < value.node.expressions.length; i++) {
          const part = value.context.text(value.node.expressions[i], new Set(seen), budget - 1);
          const tail = value.node.quasis[i + 1].value.cooked;
          if (part === undefined || typeof tail !== 'string') return;
          text += part + tail;
        }
        return text;
      }
    },
    resolve(node, seen = new Set(), budget = 32) {
      if (!node || budget <= 0) return;
      if (node.type === 'ChainExpression') return context.resolve(node.expression, seen, budget - 1);
      if (node.type === 'Identifier') {
        const binding = lookup(node);
        if (!binding || binding.unknown || seen.has(binding)) return;
        seen = new Set(seen).add(binding);
        if (binding.source) {
          const imported = loadImport(binding.source);
          return binding.imported === '*' ? imported && { namespace: imported } : imported?.exported(binding.imported, seen, budget - 1);
        }
        if (binding.object) {
          const object = context.resolve(binding.object, seen, budget - 1);
          if (object?.namespace) return object.namespace.exported(binding.key, seen, budget - 1);
          const value = object?.context?.field(object.node, binding.key, seen, budget - 1);
          return value?.context.resolve(value.node, seen, budget - 1);
        }
        return context.resolve(binding.node, seen, budget - 1);
      }
      if (node.type === 'MemberExpression') {
        const key = node.computed ? context.text(node.property, new Set(seen), budget - 1) : node.property.name;
        const object = context.resolve(node.object, seen, budget - 1);
        if (object?.namespace) return object.namespace.exported(key, seen, budget - 1);
        const value = object?.context.field(object.node, key, seen, budget - 1);
        return value ? value.context.resolve(value.node, seen, budget - 1) : { node, context };
      }
      if (node.type === 'CallExpression') {
        const requireCall = node.arguments.length === 1 &&
          (node.callee.name === 'require' && !lookup(node.callee) ||
           member(node.callee, 'require') && node.callee.object.type === 'MetaProperty');
        if (requireCall) {
          const specifier = context.text(node.arguments[0], new Set(seen), budget - 1);
          const imported = specifier !== undefined && loadImport(specifier);
          return imported ? { namespace: imported } : undefined;
        }
        const target = context.resolve(node.callee, seen, budget - 1);
        if (!target?.node || !functionNode(target.node) || target.node.async || target.node.generator ||
            target.node.params.length || node.arguments.length) return { node, context };
        const body = target.node.body;
        if (body.type !== 'BlockStatement') return target.context.resolve(body, seen, budget - 1);
        const statements = body.body.filter(statement => !statement.directive && statement.type !== 'EmptyStatement');
        if (statements.at(-1)?.type !== 'ReturnStatement' ||
            statements.slice(0, -1).some(statement => statement.type !== 'VariableDeclaration')) return { node, context };
        return target.context.resolve(statements.at(-1).argument, seen, budget - 1);
      }
      return { node, context };
    },
  };
  return context;
}

export function applyAstEdits(code, edits) {
  if (!edits.length) return code;
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  const parts = [];
  let cursor = 0;
  let prev;
  for (const edit of sorted) {
    if (edit.start < cursor) {
      const snippet = (e) => JSON.stringify(code.slice(e.start, Math.min(e.end, e.start + 60)));
      const repl = (e) => JSON.stringify((e.replacement ?? '').slice(0, 60));
      throw new Error(
        `Overlapping AST patch edits: previous [${prev.start},${prev.end}) ${snippet(prev)} → ${repl(prev)}; ` +
        `current [${edit.start},${edit.end}) ${snippet(edit)} → ${repl(edit)}`);
    }
    const padding = code[edit.start - 1] === '/' && edit.replacement.startsWith('/*') ? ' ' : '';
    parts.push(code.slice(cursor, edit.start), padding, edit.replacement);
    cursor = edit.end;
    prev = edit;
  }
  parts.push(code.slice(cursor));
  return parts.join('');
}
