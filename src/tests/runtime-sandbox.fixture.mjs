import { runInNewContext } from 'node:vm';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from '../shared/acorn.mjs';
import { applyAstEdits, walk } from '../shared/ast-helpers.mjs';

// Preserve the existing synchronous dependency mocks while production uses ESM.
// Real module loading is covered by the lifecycle and compiled-runtime fixtures.
export function runRuntimeFixture(source, sandbox) {
  const edits = [];
  walk(parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }), node => {
    if (node.type === 'ImportDeclaration') {
      const specifiers = node.specifiers.map(item => item.type === 'ImportNamespaceSpecifier' ? null
        : `${item.type === 'ImportDefaultSpecifier' ? 'default' : item.imported.name}: ${item.local.name}`);
      const request = `require(${JSON.stringify(node.source.value.replace(/^node:/, ''))})`;
      const replacement = !node.specifiers.length ? request + ';'
        : node.specifiers[0].type === 'ImportNamespaceSpecifier' ? `const ${node.specifiers[0].local.name} = ${request};`
        : `const {${specifiers.join(',')}} = ${request};`;
      edits.push({ start: node.start, end: node.end, replacement });
      return false;
    }
    if (node.type === 'ExportNamedDeclaration' && !node.declaration) {
      edits.push({ start: node.start, end: node.end, replacement: `module.exports = {${node.specifiers.map(s => `${s.exported.name}:${s.local.name}`).join(',')}};` });
      return false;
    }
    if (node.type === 'AwaitExpression') edits.push({ start: node.start, end: node.argument.start, replacement: '' });
    if (node.type === 'ImportExpression') {
      edits.push({ start: node.start, end: node.source.start, replacement: 'require(' });
    }
    if (node.type === 'MetaProperty') edits.push({ start: node.start, end: node.end, replacement: '__moduleMeta' });
  });
  return runInNewContext(applyAstEdits(source, edits), {
    __moduleMeta: { url: pathToFileURL(join(sandbox.__dirname || '.', 'cli.mjs')).href, main: false }, ...sandbox,
  });
}
