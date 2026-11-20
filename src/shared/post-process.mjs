import { readFileSync, writeFileSync, unlinkSync, existsSync, realpathSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parse, tokenizer } from './acorn.mjs';
import { applyAstEdits, walk } from './ast-helpers.mjs';

const here = realpathSync.native(dirname(fileURLToPath(import.meta.url)));
const src = `${here}/cli.original.js`;
const dst = `${here}/cli.original.cjs`;
const pathMapFile = `${here}/pathmap.json`;

let code = stripPragma(readFileSync(src, 'utf8'));

const isChunked = existsSync(pathMapFile);

function stripPragma(c) { return c.replace(/^(?:\/\/[^\n]*\n)+/, ''); }

function fixFileURLs(c) {
  return c.replace(
    /[\w$]+\.fileURLToPath\("file:\/\/\/home\/runner\/work\/claude-cli-internal\/claude-cli-internal\/[^"]*"\)/g,
    () => '__filename',
  );
}

function fixAssetRequires(c, assets) {
  if (!c.includes('import') || !c.includes('require') && !/\\(?:u(?:[\da-f]{4}|\{)|x[\da-f]{2})/i.test(c)) return c;
  // Token values cover comments, whitespace, escaped names and bracket access.
  // Complex accesses still use the AST path; plain module requires need no rewrite.
  let candidate = false;
  try {
    const tokens = tokenizer(c, { ecmaVersion: 'latest', sourceType: 'module' });
    let previous;
    for (;;) {
      const token = tokens.getToken();
      if (token.type.label === 'eof') break;
      if (previous === 'import' && token.type.label === '.') { candidate = true; break; }
      previous = token.type.label;
    }
  } catch { candidate = true; }
  if (!candidate) return c;
  const marker = '/*clawgod:asset-require*/';
  const isRequire = node => node?.type === 'MemberExpression' &&
    (node.computed ? node.property.value === 'require' : node.property.name === 'require') &&
    node.object.type === 'MetaProperty' && node.object.meta.name === 'import';
  const edits = [];
  walk(parse(c, { ecmaVersion: 'latest', sourceType: 'module' }), node => {
    if (node.type === 'ArrowFunctionExpression' &&
        c.startsWith(marker, node.body.start + 1)) return false;
    const alias = node.type === 'VariableDeclarator' ? node.init
      : node.type === 'AssignmentExpression' && node.operator === '=' ? node.right : null;
    if (isRequire(alias)) edits.push(alias);
    if (node.type === 'CallExpression' && isRequire(node.callee)) {
      const id = node.arguments[0]?.value;
      const key = typeof id === 'string' && process.platform === 'win32' ? id.toLowerCase() : id;
      if (typeof id !== 'string' || assets.has(key)) edits.push(node.callee);
    }
  });
  if (!edits.length) return c;
  const loader = `(() => {${marker}
        const fs = import.meta.require('node:fs');
        const path = import.meta.require('node:path');
    const types = new Map(${JSON.stringify([...assets])});
    return (id) => {
      if (typeof id === 'string' && path.isAbsolute(id) && fs.existsSync(id)) {
        const canonical = fs.realpathSync.native(id);
        const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
        const type = types.get(key);
        if (type === 'text') return fs.readFileSync(id, 'utf8');
        if (type === 'file') return id;
      }
      return import.meta.require(id);
    };
  })()`;
  return applyAstEdits(c, edits.map(({ start, end }) => ({ start, end, replacement: loader })));
}

if (isChunked) {
  const pathMap = JSON.parse(readFileSync(pathMapFile, 'utf8'));
  const replaceTable = new Map();
  const assets = new Map();
  const graphFiles = new Set();
  for (const [bunPath, entry] of Object.entries(pathMap)) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.loader !== 'string') {
      throw new Error('Embedded loader metadata is missing. Rerun the current installer to re-extract this Claude version.');
    }
    const { path, loader } = entry;
    const target = join(here, path);
    replaceTable.set(bunPath, target);
    if (loader === 'text' || loader === 'file') {
      const canonical = realpathSync.native(target);
      assets.set(process.platform === 'win32' ? canonical.toLowerCase() : canonical, loader);
    }
    if (['js', 'jsx', 'ts', 'tsx'].includes(loader) && path.startsWith('bunfs/')) {
      graphFiles.add(target);
    }
  }

  function rewriteGraph(text) {
    text = text.replace(/["'`](?:\/\$bunfs\/root|[A-Za-z]:\/~BUN\/root)\/[^"'`]+["'`]/g, (m) => {
      const body = m.slice(1, -1);
      const target = replaceTable.get(body) || replaceTable.get(body.replaceAll('\\','/'));
      return target ? JSON.stringify(target) : m;
    });
    return fixAssetRequires(fixFileURLs(text), assets);
  }

  code = rewriteGraph(code);
  writeFileSync(dst, code);
  unlinkSync(src);

  for (const fp of graphFiles) {
    const original = readFileSync(fp, 'utf8');
    const rewritten = rewriteGraph(stripPragma(original));
    if (rewritten !== original) writeFileSync(fp, rewritten);
  }
  console.log(`cli.original.cjs: ${code.length} bytes (chunked, processed ${graphFiles.size} graph files)`);
} else {
  code = code.replace(
    /require\(['"](\/\$bunfs\/root\/([\w-]+)\.node)['"]\)/g,
    (m, _full, name) =>
      `require(require('path').join(__dirname,'vendor',${JSON.stringify(name)},\`\${process.arch==='arm64'?'arm64':'x64'}-\${process.platform==='darwin'?'darwin':process.platform==='linux'?'linux':'win32'}\`,${JSON.stringify(name + '.node')}))`,
  );

  code = fixFileURLs(code);

  code = code.replace(/\}\)\s*$/, '})(exports, require, module, __filename, __dirname)');

  writeFileSync(dst, code);
  unlinkSync(src);
  console.log(`cli.original.cjs: ${code.length} bytes`);
}
