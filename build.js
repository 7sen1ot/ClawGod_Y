#!/usr/bin/env bun

const {
  chmodSync,
  existsSync,
  readFileSync,
  writeFileSync,
} = require('node:fs');
const { join } = require('node:path');
const { featuresMeta } = require('./src/shared/patch-registry.mjs');
const { sharedSources, windowsSources, templateValuesFor } = require('./src/install-files.cjs');

const ROOT = __dirname;
const SOURCE_ROOT = join(ROOT, 'src');
const PLACEHOLDER_RE = /{{CLAWGOD:[^}]+}}/g;

const escapeNonAscii = (content) => content.replace(
  /[^\x00-\x7F]/g,
  (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
);

const FEATURES_META_MARKER = 'const CLAWGOD_FEATURES_META = {};';

function weaveFeaturesMeta(content, meta) {
  if (!content.includes(FEATURES_META_MARKER)) {
    throw new Error(`wrapper source missing ${FEATURES_META_MARKER} marker`);
  }
  const rendered = `const CLAWGOD_FEATURES_META = ${JSON.stringify(meta, null, 2)};`;
  return content.replace(FEATURES_META_MARKER, () => rendered);
}

const sourceCache = new Map();
function readSource(relativePath) {
  if (sourceCache.has(relativePath)) return sourceCache.get(relativePath);
  const path = join(SOURCE_ROOT, relativePath);
  const content = readFileSync(path, 'utf8');
  if (!content.endsWith('\n')) {
    throw new Error(`Build source must end with a newline: ${relativePath}`);
  }
  const source = content.slice(0, -1);
  sourceCache.set(relativePath, source);
  return source;
}

function render(target, sources, meta, uninstaller) {
  const asciiOnly = target.endsWith('.ps1');
  const templatePath = join(SOURCE_ROOT, 'templates', target);
  const lists = templateValuesFor(target, uninstaller);
  const names = new Set([...Object.keys(sources), ...Object.keys(lists)]);
  const used = new Set();
  const output = readFileSync(templatePath, 'utf8').replace(/^\uFEFF/, '').replace(PLACEHOLDER_RE, placeholder => {
    const name = placeholder.slice('{{CLAWGOD:'.length, -2);
    if (!names.has(name)) throw new Error(`${target}: unknown placeholder: ${placeholder}`);
    if (used.has(name)) throw new Error(`${target}: duplicate placeholder: ${placeholder}`);
    used.add(name);
    if (Object.hasOwn(lists, name)) return lists[name];
    let content = readSource(sources[name]);
    if (name === 'feature-gates.cjs') content = weaveFeaturesMeta(content, meta);
    return asciiOnly ? escapeNonAscii(content) : content;
  });
  for (const name of names) {
    if (!used.has(name)) throw new Error(`${target}: missing placeholder: {{CLAWGOD:${name}}}`);
  }

  const unresolved = output.match(PLACEHOLDER_RE);
  if (unresolved) {
    throw new Error(`${target}: unresolved placeholders: ${[...new Set(unresolved)].join(', ')}`);
  }
  if (asciiOnly) {
    const nonAsciiIndex = output.search(/[^\x00-\x7F]/);
    if (nonAsciiIndex !== -1) {
      const codePoint = output.codePointAt(nonAsciiIndex).toString(16).toUpperCase();
      throw new Error(`${target}: non-ASCII U+${codePoint} at character ${nonAsciiIndex}`);
    }
  }
  return output;
}

function main() {
  const check = process.argv.includes('--check');
  const unknown = process.argv.slice(2).filter((arg) => arg !== '--check');
  if (unknown.length > 0) {
    console.error(`Unknown argument(s): ${unknown.join(' ')}`);
    process.exit(2);
  }

  const meta = featuresMeta();
  const outputs = {};
  for (const [ext, sources] of Object.entries({ sh: sharedSources, ps1: windowsSources })) {
    const uninstaller = render('uninstall.' + ext, {}, meta);
    outputs['uninstall.' + ext] = uninstaller;
    outputs['install.' + ext] = render('install.' + ext, sources, meta, uninstaller);
  }
  const compare = check && Object.keys(outputs).some(name => existsSync(join(ROOT, name)));
  for (const [name, content] of Object.entries(outputs)) {
    const path = join(ROOT, name);
    if (check) {
      if (compare && (!existsSync(path) || readFileSync(path, 'utf8') !== content)) {
        console.error(`out of date: ${name}`);
        process.exitCode = 1;
      } else console.log(`${compare ? 'ok' : 'source ok'}: ${name}`);
      continue;
    }
    writeFileSync(path, content, 'utf8');
    if (name.endsWith('.sh')) chmodSync(path, 0o755);
    console.log(`built: ${name} (${Buffer.byteLength(content)} bytes)`);
  }
}

main();
