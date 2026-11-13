import { accessSync, constants, createReadStream, existsSync, lstatSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyAstEdits, parsePatchSource, releasePatchSource, walk } from './ast-patches.mjs';
import { tokenizer } from './acorn.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, 'cli.cjs');
const marker = join(here, '.compiled-runtime');
const cacheFile = join(here, '.compiled-runtime-cache.json');
const name = `cli.compiled-${Date.now()}-${process.pid}${process.platform === 'win32' ? '.exe' : ''}`;
const output = join(here, name);
const temporaryMarker = `${marker}.${process.pid}.tmp`;
const temporaryCache = `${cacheFile}.${process.pid}.tmp`;

async function fileDigest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function buildInputs() {
  const paths = new Set();
  // Runtime-only files; onLoad disables cache reuse if a source imports them.
  const runtimeFiles = new Set(['source-backup.json', 'provider.json', 'features.json',
    'patches.json', 'assembly.json', 'flags.json', 'lean-settings.json', '.compiled-runtime-cache.json']);
  const customConfig = /^(?:tsconfig\.json|jsconfig\.json|\.?bunfig\.toml)$/;
  function collect(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (dir === here && !['bunfs', 'vendor'].includes(item.name) &&
          (!/\.(?:[cm]?js|jsx|tsx?|json|toml)$/.test(item.name) || runtimeFiles.has(item.name))) continue;
      const path = join(dir, item.name);
      if (item.isSymbolicLink() || customConfig.test(item.name)) throw new Error('custom build input');
      if (item.isDirectory()) collect(path);
      else if (item.isFile()) paths.add(path);
      else throw new Error('unsupported build input');
    }
  }
  collect(here);
  // Include ancestor package metadata; custom tsconfig/bunfig chains require a fresh build.
  const visited = new Set();
  for (const start of [here, resolve(process.cwd())]) {
    for (let dir = start; ; dir = dirname(dir)) {
      if (visited.has(dir)) break;
      visited.add(dir);
      for (const name of ['tsconfig.json', 'jsconfig.json', 'bunfig.toml', '.bunfig.toml']) {
        if (existsSync(join(dir, name))) return null;
      }
      const pkg = join(dir, 'package.json');
      if (existsSync(pkg)) paths.add(pkg);
      if (dir === dirname(dir)) break;
    }
  }
  const hash = createHash('sha256');
  hash.update(JSON.stringify([1, Bun.version, Bun.revision, process.platform, process.arch,
    realpathSync(here), process.execPath, process.cwd(), process.env.NODE_ENV ?? '', process.env.BUN_ENV ?? '']));
  const sorted = [...paths].sort(), digests = new Array(sorted.length);
  let next = 0;
  const workers = await Promise.allSettled(Array.from({ length: Math.min(4, sorted.length) }, async () => {
    while (next < sorted.length) {
      const index = next++;
      digests[index] = await fileDigest(sorted[index]);
    }
  }));
  const rejected = workers.find(result => result.status === 'rejected');
  if (rejected) throw rejected.reason;
  const files = new Set(sorted);
  for (const [index, path] of sorted.entries()) hash.update(JSON.stringify([path, digests[index]]));
  return { key: hash.digest('hex'), files };
}

function rewriteLocalRequires(contents, path) {
  const isLocal = value => {
    if (typeof value !== 'string' || !/\.[cm]?js$/.test(value)) return false;
    const target = resolve(dirname(path), value), local = relative(here, target);
    return local !== '..' && !local.startsWith('../') && !local.startsWith('..\\') &&
      !isAbsolute(local) && existsSync(target);
  };
  const directEdits = () => {
    const tokens = tokenizer(contents, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
    const recent = [], edits = [];
    for (;;) {
      const token = tokens.getToken();
      if (token.type.label === 'eof') return edits;
      recent.push(token);
      if (recent.length > 4) recent.shift();
      if (recent.length < 3) continue;
      const [start, dot, meta] = recent.slice(-3);
      if (start?.type.label !== 'import' || dot.type.label !== '.' || meta.value !== 'meta' ||
          meta.type.label !== 'name' || recent.length === 4 && ['.', '?.'].includes(recent[0].type.label)) continue;
      if (recent.length === 4 && recent[0].type.label === 'new') return null;
      const access = tokens.getToken(), property = tokens.getToken();
      if (access.type.label !== '.' || property.type.label !== 'name') return null;
      recent.splice(0, recent.length, access, property);
      if (property.value !== 'require') continue;
      const open = tokens.getToken(), argument = tokens.getToken(), close = tokens.getToken();
      // Parenthesized, optional, computed or multi-argument calls use the AST path.
      if (open.type.label !== '(' || argument.type.label !== 'string' || close.type.label !== ')') return null;
      if (isLocal(argument.value)) edits.push({ start: start.start, end: property.end, replacement: 'require' });
      recent.splice(0, recent.length, close);
    }
  };
  let edits;
  try { edits = directEdits(); } catch { /* The parser handles unusual lexical contexts. */ }
  if (edits == null) {
    edits = [];
    try {
      walk(parsePatchSource(contents), node => {
        const callee = node.callee;
        if (node.type !== 'CallExpression' || node.arguments.length !== 1 ||
            callee.type !== 'MemberExpression' || callee.computed || callee.property.name !== 'require' ||
            callee.object.type !== 'MetaProperty' || callee.object.meta.name !== 'import') return;
        const argument = node.arguments[0];
        if (argument.type === 'Literal' && isLocal(argument.value)) {
          edits.push({ start: callee.start, end: callee.end, replacement: 'require' });
        }
      });
    } finally { releasePatchSource(contents); }
  }
  return applyAstEdits(contents, edits);
}

function activate(filename) {
  writeFileSync(temporaryMarker, filename + '\n');
  renameSync(temporaryMarker, marker);
}

rmSync(marker, { force: true });
async function compile() {
  try {
    const original = readFileSync(join(here, 'cli.original.cjs'), 'utf8');
    const manifest = original.match(/^\/\/ clawgod:probe-modules (.+)$/m);
    const probes = manifest && JSON.parse(manifest[1]);
    if (!Array.isArray(probes) || !probes.length) throw new Error('tool probe manifest is missing');

    const inputs = await buildInputs().catch(() => null);
    try {
      const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
      if (inputs && cached.key === inputs.key && /^cli\.compiled-\d+-\d+(?:\.exe)?$/.test(cached.name)) {
        const executable = join(here, cached.name);
        accessSync(executable, constants.X_OK);
        if (lstatSync(executable).isFile() && await fileDigest(executable) === cached.digest) {
          activate(cached.name);
          console.log('[clawgod] Reusing unchanged compiled startup runtime.');
          return;
        }
      }
    } catch { /* Missing, damaged or unusable cache: compile normally. */ }
    let reusable = Boolean(inputs);

    const result = await Bun.build({
      entrypoints: [entry],
      target: 'bun',
      format: 'esm',
      bytecode: true,
      bytecodeDepth: 0,
      compile: { outfile: output },
      packages: 'external',
      external: ['*.node', '*.txt', '*.md'],
      minify: { whitespace: true },
      ignoreDCEAnnotations: true,
      plugins: [{
        name: 'clawgod-local-modules',
        setup(build) {
          build.onLoad({ filter: /.*/ }, ({ path }) => {
            if (!inputs?.files.has(resolve(path))) reusable = false;
            if (!/\.(?:[cm]?js)$/.test(path)) return;
            let contents = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
            if (resolve(path) === entry) {
              const loop = 'for (const name of modules) require(join(__dirname, name));';
              if (!contents.includes(loop)) throw new Error('unsupported tool probe loader');
              contents = contents.replace(loop, () => probes.map(module => `require(${JSON.stringify(join(here, module))});`).join(''));
              contents = contents.replace(/\b__dirname\b/g, () => JSON.stringify(here));
            }
            if (contents.includes('import.meta.require')) {
              contents = rewriteLocalRequires(contents, path);
            }
            return { contents, loader: 'js' };
          });
        },
      }],
    });
    if (!result.success) throw new Error(result.logs.map(log => log.message).join('\n'));
    try {
      rmSync(cacheFile, { force: true });
      if (reusable && (await buildInputs())?.key === inputs.key) {
        writeFileSync(temporaryCache, JSON.stringify({ key: inputs.key, name, digest: await fileDigest(output) }) + '\n');
        renameSync(temporaryCache, cacheFile);
      }
    } catch { /* Cache persistence must not prevent using a successful build. */ }
    activate(name);
    console.log('[clawgod] Compiled startup runtime ready.');
  } catch (error) {
    rmSync(output, { force: true });
    rmSync(temporaryMarker, { force: true });
    const details = error.errors?.map(issue => {
      const pos = issue.position;
      return (pos ? `${pos.file}:${pos.line}:${pos.column}: ` : '') + issue.message;
    }).join('\n') || error.message;
    console.warn('[clawgod] Startup compilation skipped; using Bun source runtime: ' + details);
  } finally {
    try { rmSync(temporaryCache, { force: true }); } catch {}
  }
}
await compile();
