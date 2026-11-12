#!/usr/bin/env node

const {
  chmodSync,
  existsSync,
  readFileSync,
  writeFileSync,
} = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

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

const SHARED_SOURCES = Object.fromEntries([
  'extract-natives.mjs', 'post-process.mjs', 'openai-proxy.cjs', 'cli.cjs',
  'startup-check.cjs', 'compile-runtime.mjs', 'runtime-helpers.cjs', 'bun-ant-shim.cjs',
  'feature-gates.cjs', 'patch.mjs', 'patch-registry.mjs', 'ast-patches.mjs',
  'pentest-patches.mjs', 'pentest-scanners.mjs', 'pentest-trimming.mjs',
  'pentest-policy-text.mjs', 'pentest-pruner.mjs', 'lean-mode.cjs',
  'system-prompt.md', 'acorn.mjs', 'acorn.LICENSE', 'features.json',
].map(name => [name, `shared/${name}`]));

const TARGETS = [
  {
    name: 'install.sh',
    template: 'templates/install.sh',
    mode: 0o755,
    sources: SHARED_SOURCES,
  },
  {
    name: 'install.ps1',
    template: 'templates/install.ps1',
    asciiOnly: true,
    sources: {
      'npm-fetch.mjs': 'windows/npm-fetch.mjs',
      ...SHARED_SOURCES,
      'lean-apply.cjs': 'windows/lean-apply.cjs',
    },
  },
];

function readSource(relativePath) {
  const path = join(SOURCE_ROOT, relativePath);
  if (!existsSync(path)) throw new Error(`Missing build source: ${relativePath}`);
  const content = readFileSync(path, 'utf8');
  if (!content.endsWith('\n')) {
    throw new Error(`Build source must end with a newline: ${relativePath}`);
  }
  return content.slice(0, -1);
}

function render(target, meta) {
  const templatePath = join(SOURCE_ROOT, target.template);
  if (!existsSync(templatePath)) throw new Error(`Missing template: ${target.template}`);
  const used = new Set();
  const output = readFileSync(templatePath, 'utf8').replace(/^\uFEFF/, '').replace(PLACEHOLDER_RE, placeholder => {
    const name = placeholder.slice('{{CLAWGOD:'.length, -2);
    if (!Object.hasOwn(target.sources, name)) throw new Error(`${target.template}: unknown placeholder: ${placeholder}`);
    if (used.has(name)) throw new Error(`${target.template}: duplicate placeholder: ${placeholder}`);
    used.add(name);
    let content = readSource(target.sources[name]);
    if (name === 'feature-gates.cjs') content = weaveFeaturesMeta(content, meta);
    return target.asciiOnly ? escapeNonAscii(content) : content;
  });
  for (const name of Object.keys(target.sources)) {
    if (!used.has(name)) throw new Error(`${target.template}: missing placeholder: {{CLAWGOD:${name}}}`);
  }

  const unresolved = output.match(PLACEHOLDER_RE);
  if (unresolved) {
    throw new Error(`${target.template}: unresolved placeholders: ${[...new Set(unresolved)].join(', ')}`);
  }
  if (target.asciiOnly) {
    const nonAsciiIndex = output.search(/[^\x00-\x7F]/);
    if (nonAsciiIndex !== -1) {
      const codePoint = output.codePointAt(nonAsciiIndex).toString(16).toUpperCase();
      throw new Error(`${target.template}: non-ASCII U+${codePoint} at character ${nonAsciiIndex}`);
    }
  }
  return output;
}

function firstDifference(actual, expected) {
  const length = Math.min(actual.length, expected.length);
  for (let index = 0; index < length; index++) {
    if (actual[index] !== expected[index]) return index;
  }
  return actual.length === expected.length ? -1 : length;
}

function checkTarget(target, expected) {
  const outputPath = join(ROOT, target.name);
  if (!existsSync(outputPath)) {
    console.error(`out of date: ${target.name} is missing`);
    return false;
  }
  const actual = readFileSync(outputPath, 'utf8');
  if (actual === expected) {
    console.log(`ok: ${target.name}`);
    return true;
  }
  const offset = firstDifference(actual, expected);
  console.error(`out of date: ${target.name} (first difference at character ${offset})`);
  return false;
}

async function main() {
  const check = process.argv.includes('--check');
  const unknown = process.argv.slice(2).filter((arg) => arg !== '--check');
  if (unknown.length > 0) {
    console.error(`Unknown argument(s): ${unknown.join(' ')}`);
    process.exit(2);
  }

  const { featuresMeta } = await import(pathToFileURL(join(SOURCE_ROOT, 'shared/patch-registry.mjs')).href);
  const meta = featuresMeta();
  let success = true;
  for (const target of TARGETS) {
    const content = render(target, meta);
    if (check) {
      success = checkTarget(target, content) && success;
      continue;
    }
    const outputPath = join(ROOT, target.name);
    writeFileSync(outputPath, content, 'utf8');
    if (target.mode) chmodSync(outputPath, target.mode);
    console.log(`built: ${target.name} (${Buffer.byteLength(content)} bytes)`);
  }
  if (!success) process.exit(1);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
