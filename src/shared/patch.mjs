#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync, renameSync, unlinkSync } from 'fs';
import { join, dirname, relative, resolve as resolvePath, sep } from 'path';
import { fileURLToPath } from 'url';
import { AST_PATCH_IDS, scanAstPatches } from './ast-patches.mjs';
import { applyAstEdits, parsePatchSource, hasPatchAnchors,
  getPatchNodeIndex, getCachedPatchContext, releasePatchContexts, releasePatchSource } from './ast-helpers.mjs';
import { PENTEST_AST_PATCH_IDS, PENTEST_AST_META, PENTEST_REQUIRED, scanPentestPatches, scanFinalPolicyEdits, scanFinalBrandingEdits, findAppliedPromptHooks, pruneRuntimeGraph } from './pentest-patches.mjs';
import { FEATURES, featuresMeta } from './patch-registry.mjs';
import { upstreamPatches } from './patch-rules.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET = join(__dirname, 'cli.original.cjs');
const BACKUP = TARGET + '.bak';
const CLEAN_SOURCE = join(__dirname, 'source-backup.json');

const PENTEST_DROPPED_IDS = new Set(FEATURES['voice-mode'].patchIds);
delete FEATURES['voice-mode'];
const patches = upstreamPatches
  .filter(p => !PENTEST_DROPPED_IDS.has(p.id))
  .concat(PENTEST_AST_PATCH_IDS.map(id => ({ id, name: PENTEST_AST_META[id], ast: true, optional: true })));

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const verify = args.includes('--verify');
const revert = args.includes('--revert');
const dumpFeatures = args.includes('--dump-features');
const captureCleanSource = args.includes('--capture-clean-source');
const captureAndApply = args.includes('--capture-and-apply');
const promptRequired = existsSync(join(__dirname, 'system-prompt.md'));

if (captureAndApply && (captureCleanSource || dryRun || verify || revert || dumpFeatures)) {
  console.error('--capture-and-apply cannot be combined with other patch modes');
  process.exit(1);
}

if (dumpFeatures) {
  console.log(JSON.stringify(featuresMeta()));
  process.exit(0);
}

(function validateRegistry() {
  const errs = [];
  const byId = new Map();
  const referenced = new Set();
  for (const p of patches) {
    if (!p.id) errs.push(`patch without id: ${p.name}`);
    else if (byId.has(p.id)) errs.push(`duplicate patch id: ${p.id}`);
    else byId.set(p.id, p);
  }
  for (const [fid, def] of Object.entries(FEATURES)) {
    for (const pid of def.patchIds) {
      referenced.add(pid);
      const p = byId.get(pid);
      if (!p) { errs.push(`feature '${fid}' references unknown patch id '${pid}'`); continue; }
      if (!p.toggleable) errs.push(`feature '${fid}' references non-toggleable patch '${pid}'`);
    }
  }
  for (const p of patches) {
    if (p.toggleable && !referenced.has(p.id)) errs.push(`toggleable patch '${p.id}' is referenced by no feature`);
  }
  if (errs.length > 0) {
    console.error('❌ Feature registry invalid:');
    for (const e of errs) console.error('   -', e);
    process.exit(1);
  }
})();

const GRAPH_DIR = join(__dirname, 'bunfs');
const isGraph = existsSync(GRAPH_DIR);
const sourcePaths = new Set([TARGET]);
if (isGraph) {
  const pathMapFile = join(__dirname, 'pathmap.json');
  const pathMap = existsSync(pathMapFile) ? JSON.parse(readFileSync(pathMapFile, 'utf8')) : null;
  if (!pathMap || Object.values(pathMap).some(entry =>
    !entry || typeof entry.path !== 'string' || typeof entry.loader !== 'string')) {
    console.error('Embedded loader metadata is missing. Rerun the current installer to re-extract this Claude version.');
    process.exit(1);
  }
  for (const { path, loader } of Object.values(pathMap)) {
    if (['js', 'jsx', 'ts', 'tsx'].includes(loader) && path.startsWith('bunfs/')) {
      sourcePaths.add(join(__dirname, path));
    }
  }
}

if (revert && !existsSync(CLEAN_SOURCE)) {
  if (isGraph) {
    console.error('No complete clean-source backup. Reinstall the same Claude version to recover it.');
    process.exit(1);
  }
  if (!existsSync(BACKUP)) { console.error('❌ No backup found'); process.exit(1); }
  if (existsSync(join(__dirname, '.compiled-runtime'))) unlinkSync(join(__dirname, '.compiled-runtime'));
  copyFileSync(BACKUP, TARGET);
  console.log('✅ Reverted from backup');
  process.exit(0);
}

if (!isGraph && !existsSync(TARGET)) {
  console.error('❌ Target not found:', TARGET);
  process.exit(1);
}
let files = { [TARGET]: readFileSync(TARGET, 'utf8') };
for (const name of sourcePaths) {
  if (name !== TARGET && existsSync(name)) files[name] = readFileSync(name, 'utf8');
}
const installedFiles = { ...files };

const version = (files[TARGET] || '').match(/Version:\s*([\d.]+)/)?.[1] || 'unknown';

if (captureCleanSource || captureAndApply) {
  const snapshot = { format: 1, version, files: Object.fromEntries(
    Object.entries(files).map(([name, content]) => [relative(__dirname, name).replaceAll('\\', '/'), content]),
  ) };
  const temporary = `${CLEAN_SOURCE}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(snapshot));
  renameSync(temporary, CLEAN_SOURCE);
  writeFileSync(BACKUP, files[TARGET], 'utf8');
  console.log(`Saved clean source: ${Object.keys(files).length} files (v${version})`);
  if (captureCleanSource) process.exit(0);
}

if (!captureAndApply && existsSync(CLEAN_SOURCE) && !verify) {
  try {
    const snapshot = JSON.parse(readFileSync(CLEAN_SOURCE, 'utf8'));
    const sourceFiles = Object.fromEntries(Object.entries(snapshot.files ?? {})
      .filter(([name]) => sourcePaths.has(join(__dirname, name))));
    const names = Object.keys(files).map(name => relative(__dirname, name).replaceAll('\\', '/'));
    const snapshotNames = Object.keys(sourceFiles);
    if (snapshot.format !== 1 || snapshot.version !== version ||
        !snapshot.files || typeof snapshot.files !== 'object' ||
        !snapshotNames.includes('cli.original.cjs') ||
        !names.every(name => Object.hasOwn(sourceFiles, name)) ||
        !snapshotNames.every(name => typeof sourceFiles[name] === 'string')) {
      throw new Error('version or file set does not match the installed source');
    }
    files = Object.fromEntries(snapshotNames.map(name => [join(__dirname, name), sourceFiles[name]]));
    console.log(`Using clean source backup: ${snapshotNames.length} files (v${version})`);
  } catch (error) {
    console.error(`Invalid clean-source backup: ${error.message}. Reinstall Claude ${version} with the current installer.`);
    process.exit(1);
  }
}
if (revert) {
  if (existsSync(join(__dirname, '.compiled-runtime'))) unlinkSync(join(__dirname, '.compiled-runtime'));
  for (const [name, content] of Object.entries(files)) writeFileSync(name, content, 'utf8');
  console.log('Reverted all source files from clean backup');
  process.exit(0);
}

const originalFiles = { ...files };

console.log(`\n${'═'.repeat(55)}`);
console.log(`  ClawGod_Y (universal)`);
console.log(`  Target: cli.original.cjs (v${version}) ${isGraph ? `[graph: ${Object.keys(files).length} files]` : ''}`);
console.log(`  Mode: ${dryRun ? 'DRY RUN' : verify ? 'VERIFY' : 'APPLY'} (best-effort features, required bundled prompt)`);
console.log(`${'═'.repeat(55)}\n`);

function collectMatches(p) {
  const out = [];
  const rules = [p, ...(p.fallbacks ?? [])];
  for (const [fname, content] of Object.entries(files)) {
    const accepted = [];
    let nodes;
    const syntaxMatch = (match, type) => {
      nodes ??= getPatchNodeIndex(content);
      const types = Array.isArray(type) ? type : [type];
      return nodes.get(match.index)?.some(node =>
        types.includes(node.type) && node.end === match.index + match[0].length);
    };
    for (const [index, rule] of rules.entries()) {
      let matches;
      if (typeof rule.pattern === 'string') {
        if (!rule.pattern) continue;
        matches = [];
        let start = content.indexOf(rule.pattern);
        while (start !== -1) {
          matches.push(Object.assign([rule.pattern], { index: start }));
          start = content.indexOf(rule.pattern, start + rule.pattern.length);
        }
      } else matches = content.matchAll(rule.pattern);
      for (const match of matches) {
        if (!match[0].length || index && accepted.some(other =>
          match.index < other.index + other[0].length && other.index < match.index + match[0].length)) continue;
        if (p.validate && !p.validate(match[0], content, match.index)) continue;
        if (index && (!rule.nodeType || !syntaxMatch(match, rule.nodeType))) continue;
        match.replacer = rule.replacer ?? p.replacer;
        match.strategy = index ? typeof rule.pattern === 'string' ? 'string-fallback' : 'regex-fallback' : 'regex';
        accepted.push(match);
      }
    }
    if (accepted.length) out.push({ file: fname, content, matches: accepted.sort((a, b) => a.index - b.index) });
  }
  return out;
}

let applied = 0, skipped = 0, failed = 0, unverified = 0;
const appliedIds = new Set();

const astMatches = new Map([...AST_PATCH_IDS, ...PENTEST_AST_PATCH_IDS].map(id => [id, []]));
const astPresent = new Set();
const astPatched = new Set();
const astSkipped = new Map();
const astEdits = new Map();
const promptSourcePaths = new Set();
try {
  const readContext = name => {
    const content = files[name];
    if (content === undefined) return;
    return getCachedPatchContext(content, name, specifier => {
      if (typeof specifier !== 'string') return;
      const target = specifier.startsWith('file:') ? fileURLToPath(specifier) :
        resolvePath(dirname(name), specifier.replaceAll('\\', sep));
      return readContext(target);
    });
  };
  for (const [file, content] of Object.entries(files)) {
    let tree;
    const readTree = () => tree ??= parsePatchSource(content);
    const result = scanAstPatches(content, readTree, () => readContext(file));
    const upstreamRanges = [];
    for (const id of AST_PATCH_IDS) {
      for (const m of result[id].matches) upstreamRanges.push([m.start, m.end]);
      upstreamRanges.push(...result[id].protected);
    }
    const pentest = scanPentestPatches(content, upstreamRanges, readTree);
    for (const scan of [result, pentest]) {
      for (const [id, found] of Object.entries(scan)) {
        const matches = found.fallbackMatches?.length ? [...found.matches, ...found.fallbackMatches] : found.matches;
        if ((PENTEST_REQUIRED.has(id) || id === 'cli-branding' || id === 'pentest-prompt-rewrite') && (found.present || found.patched || matches.length || found.skipped)) {
          promptSourcePaths.add(file);
        }
        if (found.present || found.fallbackMatches?.length) astPresent.add(id);
        if (found.patched) astPatched.add(id);
        if (found.skipped) astSkipped.set(id, (astSkipped.get(id) ?? 0) + found.skipped);
        if (matches.length) astMatches.get(id).push({ file, content, matches });
      }
    }
  }
} catch (error) {
  console.error(`AST scan failed: ${error.message}. Source files were not changed.`);
  process.exit(1);
}
releasePatchContexts();

let astFlushed = false;
for (const p of [...patches.filter(p => p.ast), ...patches.filter(p => !p.ast)]) {
  if (!p.ast && !astFlushed) {
    try {
      for (const [file, edits] of astEdits) {
        files[file] = applyAstEdits(files[file], edits);
        parsePatchSource(files[file]);
      }
    } catch (error) {
      console.error(`AST rewrite failed: ${error.message}. Source files were not changed.`);
      process.exit(1);
    }
    astFlushed = true;
  }
  const preferredRule = p.fallbackFor?.find(id => appliedIds.has(id));
  if (preferredRule) {
    console.log(`  ⏭  ${p.name} (covered by applied rule: ${preferredRule})`);
    skipped++;
    continue;
  }
  const fileMatches = p.ast ? astMatches.get(p.id) : collectMatches(p);

  let fileChangedCount = 0;
  const strategies = new Map();

  if (fileMatches.length === 0) {
    if (p.appliedSentinel && Object.values(files).some(content => content.includes(p.appliedSentinel))) {
      console.log(`  ✅ ${p.name} (already applied, patch marker present)`);
      applied++;
      appliedIds.add(p.id);
      continue;
    }
    if (p.ast && astPatched.has(p.id) && !astPresent.has(p.id)) {
      console.log(`  ✅ ${p.name} (already applied, AST gate present)`);
      applied++;
      appliedIds.add(p.id);
      continue;
    }
    if (p.required || promptRequired && PENTEST_REQUIRED.has(p.id)) {
      console.log(`  ❌ ${p.name} (required runtime hook did not match — upstream runtime changed)`);
      failed++;
      continue;
    }
    const sentinels = p.ast ? [p.id] :
      (Array.isArray(p.sentinel) ? p.sentinel : [p.sentinel])
        .filter(s => typeof s === 'string' && s.length > 0);
    const anchorPresent = p.ast ? astPresent.has(p.id) :
      sentinels.length > 0 && Object.values(files).some(content => hasPatchAnchors(content, [sentinels]));
    const coveringRule = p.coveredBy?.find(id => appliedIds.has(id));
    // A text rule is covered only when its original anchor was removed.
    if (coveringRule && (p.sentinel === undefined || !anchorPresent &&
        sentinels.length > 0 && Object.values(originalFiles).some(content => hasPatchAnchors(content, [sentinels])))) {
      console.log(`  ⏭  ${p.name} (covered by applied rule: ${coveringRule})`);
      skipped++;
      continue;
    }
    if (p.optional && !anchorPresent) {
      console.log(`  ⏭  ${p.name} (not present in this version)`);
      skipped++;
      continue;
    }
    if (p.sentinel !== undefined || (p.ast && anchorPresent)) {
      if (anchorPresent) {
        const detail = sentinels.map((s) => JSON.stringify(s)).join(', ');
        console.log(`  ⚠️  ${p.name} — ${p.ast ? 'AST matcher' : 'regex'} stale, sentinel still in source: ${detail} (skipped, upstream behavior kept)`);
        skipped++;
        unverified++;
        continue;
      }
      console.log(`  ⏭  ${p.name} (no matching anchor; application cannot be verified)`);
      skipped++;
      continue;
    }
    console.log(`  ⚠️  ${p.name} (0 matches, no sentinel — cannot verify)`);
    skipped++;
    unverified++;
    continue;
  }

  if (verify) {
    const totalMatches = fileMatches.reduce((total, fm) => total + fm.matches.length, 0);
    console.log(`  ⬚  ${p.name} — ${totalMatches} match(es), not yet applied`);
    skipped++;
    continue;
  }

  const uniqueLimit = p.unique ? 1 : Infinity;
  let appliedFiles = 0;
  for (const fm of fileMatches) {
    if (appliedFiles >= uniqueLimit) break;
    let count = 0;
    const replacements = [];
    for (const m of fm.matches) {
      const original = p.ast ? fm.content.slice(m.start, m.end) : m[0];
      const replacement = p.ast ? m.replacement : m.replacer(m[0], ...m.slice(1));
      if (replacement !== original) {
        if (p.ast) {
          if (!astEdits.has(fm.file)) astEdits.set(fm.file, []);
          astEdits.get(fm.file).push(m);
        } else {
          replacements.push({ start: m.index, end: m.index + m[0].length, replacement });
        }
        count++;
        if (m.strategy && m.strategy !== 'ast' && m.strategy !== 'regex') {
          strategies.set(m.strategy, (strategies.get(m.strategy) ?? 0) + 1);
        }
      }
    }
    if (replacements.length) {
      files[fm.file] = applyAstEdits(fm.content, replacements);
      if (fm.content !== originalFiles[fm.file] && fm.content !== files[fm.file]) releasePatchSource(fm.content);
    }
    if (count > 0) appliedFiles++;
    fileChangedCount += count;
  }

  if (fileChangedCount > 0) {
    const skippedNote = astSkipped.get(p.id) ? `, ${astSkipped.get(p.id)} site(s) left unpatched` : '';
    console.log(`  ✅ ${p.name} (${fileChangedCount} replacement${fileChangedCount > 1 ? 's' : ''} in ${appliedFiles} file${appliedFiles > 1 ? 's' : ''}${skippedNote})`);
    if (strategies.size) console.log(`     Fallbacks: ${[...strategies].map(([kind, count]) => `${count} ${kind}`).join(', ')}`);
    if (strategies.has('runtime-hook')) {
      console.warn('     Runtime fallback installed; boolean result and activation are checked at call time, not verified during patching.');
      unverified++;
    }
    if (astSkipped.get(p.id)) {
      console.warn(`  ⚠️  ${p.id}: ${astSkipped.get(p.id)} site(s) NOT patched — coverage is partial`);
      if (promptRequired && PENTEST_REQUIRED.has(p.id)) failed++;
      else unverified++;
    }
    applied++;
    appliedIds.add(p.id);
  } else {
    console.log(`  ⏭  ${p.name} (no change needed)`);
    skipped++;
  }
}

astMatches.clear();
astEdits.clear();

console.log(`\n${'─'.repeat(55)}`);
console.log(`  Result: ${applied} applied, ${skipped} skipped, ${failed} failed`);
if (unverified > 0 && failed === 0) {
  console.log(`  ⚠️  Patching completed; ${unverified} feature patch(es) have unverified or partial coverage. Unmatched sites keep upstream behavior.`);
}

if (failed > 0) {
  console.error('Patching failed; source files were not changed.');
  process.exit(1);
}

if (!dryRun && !verify && applied > 0) {
  try {
    const pruned = pruneRuntimeGraph(files, originalFiles);
    for (const [name, content] of Object.entries(pruned)) {
      if (content !== files[name]) parsePatchSource(content);
    }
    const removedCount = Object.keys(files).length - Object.keys(pruned).length;
    files = pruned;
    if (removedCount > 0) {
      console.log(`  ✂️  Pruned: ${removedCount} unreachable chunk(s) (deleted after all sources are written)`);
    }
  } catch (error) {
    console.error(`Pentest prune failed: ${error.message}. Source files were not changed.`);
    process.exit(1);
  }
}

if (promptRequired && !dryRun) {
  const hooks = new Set();
  let finalized = false;
  if (!verify) for (const [file, content] of Object.entries(files)) {
    try {
      let next = content;
      // Structural edits and pruning can reintroduce host prose. Finish policy
      // cleanup first so it cannot hide branding edits in the same template.
      for (const scan of [scanFinalPolicyEdits, scanFinalBrandingEdits]) {
        const edits = scan(next);
        if (edits === null) continue;
        promptSourcePaths.add(file);
        if (!edits.length) continue;
        const previous = next;
        next = applyAstEdits(next, edits);
        parsePatchSource(next);
        releasePatchSource(previous);
        finalized = true;
      }
      files[file] = next;
    } catch (error) {
      console.error(`Application prompt cleanup failed in ${relative(__dirname, file)}: ${error.message}; source files were not changed.`);
      process.exit(1);
    }
  }
  if (finalized) applied++;
  // Recheck every surviving prompt module, including modules without any applied marker.
  // Seeing all hook IDs once does not prove that other call sites were covered.
  for (const file of promptSourcePaths) {
    const content = files[file];
    if (content === undefined) continue;
    try {
      for (const id of findAppliedPromptHooks(content)) hooks.add(id);
    } catch (error) {
      console.error(`Required application prompt verification failed in ${relative(__dirname, file)}: ${error.message}; source files were not changed.`);
      process.exit(1);
    }
  }
  const missing = [...PENTEST_REQUIRED].filter(id => !hooks.has(id));
  if (missing.length) {
    console.error(`Required application prompt hooks are missing after rewriting: ${missing.join(', ')}; source files were not changed.`);
    process.exit(1);
  }
}

if (!dryRun && !verify && applied > 0) {
  const probeModules = Object.entries(files)
    .filter(([, content]) => content.includes('/*clawgod:runtime-table-probe*/'))
    .map(([name]) => relative(__dirname, name).replaceAll('\\', '/')).sort();
  const previousEntry = files[TARGET];
  files[TARGET] = files[TARGET].replace(/^\/\/ clawgod:probe-modules .+\r?\n/gm, '');
  if (probeModules.length) files[TARGET] = `// clawgod:probe-modules ${JSON.stringify(probeModules)}\n${files[TARGET]}`;
  parsePatchSource(files[TARGET]);
  if (previousEntry !== files[TARGET]) releasePatchSource(previousEntry);
  if (!existsSync(BACKUP)) {
    copyFileSync(TARGET, BACKUP);
    console.log(`  📦 Backup: ${BACKUP}`);
  }
  const staged = [];
  try {
    if (existsSync(join(__dirname, '.compiled-runtime'))) unlinkSync(join(__dirname, '.compiled-runtime'));
    for (const [fname, content] of Object.entries(files)) {
      if (content === installedFiles[fname]) continue;
      const tmp = `${fname}.clawgod-${process.pid}.tmp`;
      writeFileSync(tmp, content, 'utf8');
      staged.push([tmp, fname]);
    }
    for (const [tmp, fname] of staged) renameSync(tmp, fname);
  } catch (error) {
    for (const [tmp] of staged) { try { if (existsSync(tmp)) unlinkSync(tmp); } catch {} }
    console.error(`Writing patched sources failed: ${error.message}. On-disk sources were left untouched.`);
    process.exit(1);
  }
  const stale = existsSync(GRAPH_DIR)
    ? readdirSync(GRAPH_DIR).filter(f => sourcePaths.has(join(GRAPH_DIR, f)))
    : [];
  for (const f of stale) {
    const full = join(GRAPH_DIR, f);
    if (!Object.hasOwn(files, full) && resolvePath(full).startsWith(resolvePath(GRAPH_DIR) + sep)) {
      try { unlinkSync(full); } catch {}
    }
  }
  console.log(`  📝 Written: ${staged.length} file(s), ${Object.keys(files).length - staged.length} unchanged ${isGraph ? '(graph)' : ''}`);
}

console.log(`${'═'.repeat(55)}\n`);
