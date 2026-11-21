import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { payloads, obsoleteFiles, generatedFiles, runtimeDirectories } from './runtime-files.mjs';
import { defaultProviderConfig } from './runtime-helpers.mjs';
import { leanApply } from './lean-mode.mjs';

const sourceDir = dirname(fileURLToPath(import.meta.url));
const installDir = join(homedir(), '.clawgod');
const binDir = join(homedir(), '.local', 'bin');
const windows = process.platform === 'win32';
const launcher = join(binDir, windows ? 'clawgod.cmd' : 'clawgod');
const nativeName = windows ? 'claude.fallback.exe' : 'claude.fallback';

function run(script, args = [], cwd = installDir) {
  const result = spawnSync(process.execPath, [join(cwd, script), ...args], {
    stdio: 'inherit', windowsHide: true, env: { ...process.env, CLAWGOD_RUNTIME_DIR: installDir },
  });
  if (result.error || result.status !== 0) throw new Error(`${script} failed: ${result.error?.message || `exit ${result.status}`}`);
}

function ownedNames() {
  const names = new Set([...payloads, ...obsoleteFiles, ...generatedFiles, ...runtimeDirectories]);
  if (existsSync(installDir)) for (const name of readdirSync(installDir)) {
    if (/^cli\.compiled-|^claude\.fallback\.\d+\.exe$/.test(name)) names.add(name);
  }
  return [...names];
}

// Every recursive operation stays under a fixed lifecycle directory.
function removeOwned(directory, name) {
  const base = resolve(directory), target = resolve(base, name);
  if (!target.startsWith(base + sep)) throw new Error(`Invalid runtime path: ${name}`);
  rmSync(target, { recursive: true, force: true });
}

function shellQuote(value) { return "'" + value.replaceAll("'", "'\\''") + "'"; }

function launcherSource() {
  if (windows) {
    const cmdPath = value => {
      if (/[\r\n"]/.test(value)) throw new Error('Launcher paths cannot contain quotes or newlines');
      return value.replaceAll('%', '%%');
    };
    const runtime = '%USERPROFILE%\\.clawgod';
    const bunRelative = relative(homedir(), process.execPath);
    const bun = !isAbsolute(bunRelative) && !bunRelative.startsWith('..')
      ? '%USERPROFILE%\\' + cmdPath(bunRelative)
      : /[^\x00-\x7f]/.test(process.execPath) ? 'bun' : cmdPath(process.execPath);
    return ['@echo off', 'setlocal DisableDelayedExpansion', `set "CLAWGOD_RUNTIME_DIR=${runtime}"`,
      `set "CLAUDE_CODE_EXECPATH=${join(runtime, nativeName)}"`, 'if not defined IS_SANDBOX set "IS_SANDBOX=1"',
      'if /I "%~1"=="import" goto source', 'if /I "%~1"=="--uninstall" goto source',
      `if not exist "${runtime}\\.compiled-runtime" goto source`,
      `set /p "CLAWGOD_COMPILED="<"${runtime}\\.compiled-runtime"`,
      `if not exist "${runtime}\\%CLAWGOD_COMPILED%" goto source`,
      `"${runtime}\\%CLAWGOD_COMPILED%" %*`, 'exit /b %ERRORLEVEL%', ':source',
      `"${bun}" "${runtime}\\cli.mjs" %*`, 'exit /b %ERRORLEVEL%', ''].join('\r\n');
  }
  return `#!/bin/sh
export CLAWGOD_RUNTIME_DIR=${shellQuote(installDir)}
export CLAUDE_CODE_EXECPATH=${shellQuote(join(installDir, nativeName))}
export IS_SANDBOX="\${IS_SANDBOX:-1}"
export HERDR_AGENT="\${HERDR_AGENT:-claude}"
if [ "$1" != import ] && [ "$1" != --uninstall ] && [ -f "$CLAWGOD_RUNTIME_DIR/.compiled-runtime" ]; then
  IFS= read -r compiled < "$CLAWGOD_RUNTIME_DIR/.compiled-runtime"
  case "$compiled" in cli.compiled-*) [ ! -x "$CLAWGOD_RUNTIME_DIR/$compiled" ] || exec "$CLAWGOD_RUNTIME_DIR/$compiled" "$@" ;; esac
fi
exec ${shellQuote(process.execPath)} "$CLAWGOD_RUNTIME_DIR/cli.mjs" "$@"
`;
}

function updatePath() {
  if (!windows) {
    if (!(process.env.PATH || '').split(sep === '\\' ? ';' : ':').includes(binDir)) console.log(`Add ${binDir} to PATH to run clawgod.`);
    return;
  }
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    "$p=[Environment]::GetEnvironmentVariable('Path','User'); $b=$env:CLAWGOD_BIN_DIR; if (-not ($p -split ';' | Where-Object { $_.TrimEnd('\\') -ieq $b.TrimEnd('\\') })) { [Environment]::SetEnvironmentVariable('Path', ($b+';'+$p), 'User') }"],
  { windowsHide: true, env: { ...process.env, CLAWGOD_BIN_DIR: binDir }, encoding: 'utf8' });
  if (result.error || result.status !== 0) console.warn(`Could not update PATH; add ${binDir} manually.`);
}

export function uninstallRuntime() {
  if (existsSync(launcher) && readFileSync(launcher, 'utf8').includes('.clawgod')) rmSync(launcher);
  for (const name of ownedNames()) removeOwned(installDir, name);
  console.log('ClawGod_Y uninstalled. Provider settings and session data were retained.');
}

export function installRuntime(version) {
  if (!/^(?:latest|stable|\d+\.\d+\.\d+)$/.test(version)) throw new Error('Usage: install-runtime.mjs [latest|stable|<version>|--uninstall]');
  const runtimeVersion = JSON.parse(readFileSync(join(sourceDir, 'runtime-version.json'), 'utf8'));
  if (typeof runtimeVersion.bun !== 'string') throw new Error('Runtime metadata is incomplete. Build or extract clawgod-runtime.tar.gz before installing.');
  if (!Bun.semver.satisfies(Bun.version, runtimeVersion.bun)) throw new Error(`Bun ${runtimeVersion.bun} is required (found ${Bun.version}). Run bun upgrade.`);
  if (!['win32', 'darwin', 'linux'].includes(process.platform) || !['x64', 'arm64'].includes(process.arch)) throw new Error('Unsupported platform');
  if (!windows && !Bun.which('rg')) throw new Error('ripgrep (rg) is required; install it and rerun the installer.');
  if (resolve(sourceDir) === resolve(installDir)) throw new Error('Run the installer from an extracted runtime archive, outside ~/.clawgod.');
  if (existsSync(installDir) && lstatSync(installDir).isSymbolicLink()) throw new Error('The installation directory cannot be a symlink');
  const temporary = mkdtempSync(join(tmpdir(), 'clawgod-install-'));
  let snapshot, replacing = false, committed = false;
  const moved = [];
  const names = ownedNames();
  const seeded = [];
  try {
    let suffix = `${process.platform}-${process.arch}`;
    if (process.platform === 'linux' && !process.report.getReport().header.glibcVersionRuntime) suffix += '-musl';
    run('npm-fetch.mjs', [`@anthropic-ai/claude-code-${suffix}@${version}`, temporary], sourceDir);
    const packageDir = join(temporary, 'package');
    const upstreamVersion = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).version;
    if (!/^\d+\.\d+\.\d+$/.test(upstreamVersion)) throw new Error('Invalid upstream package version');
    const native = join(packageDir, windows ? 'claude.exe' : 'claude');
    if (!lstatSync(native).isFile()) throw new Error('Upstream native executable is missing');
    mkdirSync(installDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    snapshot = mkdtempSync(join(dirname(installDir), '.clawgod-rollback-'));
    const hadLauncher = existsSync(launcher);
    if (hadLauncher) copyFileSync(launcher, join(snapshot, 'launcher'));
    writeFileSync(join(snapshot, 'launcher-state.json'), JSON.stringify({ existed: hadLauncher }));
    for (const name of names) if (existsSync(join(installDir, name))) {
      renameSync(join(installDir, name), join(snapshot, name));
      moved.push(name);
    }
    replacing = true;
    for (const name of payloads) copyFileSync(join(sourceDir, name), join(installDir, name));
    if (moved.includes('lean-settings.json')) copyFileSync(join(snapshot, 'lean-settings.json'), join(installDir, 'lean-settings.json'));
    for (const name of ['features.json', 'provider.json']) {
      const path = join(installDir, name);
      if (existsSync(path)) continue;
      const data = name === 'features.json' ? readFileSync(join(sourceDir, name))
        : JSON.stringify(defaultProviderConfig, null, 2) + '\n';
      writeFileSync(path, data, { flag: 'wx', mode: 0o600 });
      seeded.push(name);
    }
    copyFileSync(native, join(installDir, nativeName));
    chmodSync(join(installDir, nativeName), 0o755);
    run('extract-natives.mjs', [join(installDir, nativeName), installDir]);
    run('post-process.mjs');
    writeFileSync(join(installDir, '.source-version'), upstreamVersion + '\n');
    writeFileSync(join(installDir, '.clawgod-version'), runtimeVersion.version + '\n');
    leanApply(join(installDir, 'lean-settings.json'));
    run('patch.mjs', ['--capture-and-apply']);
    console.log('Renderer runtime: Bun APIs with bun-ant-shim.mjs for Bun.ant.CellSegmenter');
    run('compile-runtime.mjs');
    run('startup-check.mjs', [process.execPath, join(installDir, 'cli.mjs')]);
    run('startup-check.mjs', [process.execPath, join(installDir, 'cli.mjs'), '--probe-tools']);
    const temporaryLauncher = `${launcher}.${process.pid}.tmp`;
    writeFileSync(temporaryLauncher, launcherSource(), { mode: 0o755 });
    renameSync(temporaryLauncher, launcher);
    committed = true;
    updatePath();
    console.log(`ClawGod_Y ${runtimeVersion.version} installed (Claude ${upstreamVersion}). Run clawgod.`);
  } catch (error) {
    if (snapshot && !committed && (replacing || moved.length)) {
      try {
        if (replacing) for (const name of ownedNames()) removeOwned(installDir, name);
        for (const name of moved) renameSync(join(snapshot, name), join(installDir, name));
        for (const name of seeded) removeOwned(installDir, name);
        const state = JSON.parse(readFileSync(join(snapshot, 'launcher-state.json'), 'utf8'));
        if (state.existed) copyFileSync(join(snapshot, 'launcher'), launcher);
        else rmSync(launcher, { force: true });
        console.error('Restored the previous installation.');
      } catch (rollbackError) {
        console.error(`Rollback failed: ${rollbackError.message}. Backup retained at ${snapshot}`);
        snapshot = undefined;
      }
    }
    throw error;
  } finally {
    removeOwned(binDir, basename(launcher) + `.${process.pid}.tmp`);
    removeOwned(tmpdir(), basename(temporary));
    if (snapshot) {
      try { removeOwned(dirname(installDir), basename(snapshot)); }
      catch { console.warn(`Could not remove the old runtime snapshot at ${snapshot}; close any running ClawGod process and remove it manually.`); }
    }
  }
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1) throw new Error('Expected one upstream version or --uninstall');
    if (args[0] === '--uninstall') uninstallRuntime();
    else installRuntime(args[0] || JSON.parse(readFileSync(join(sourceDir, 'runtime-version.json'), 'utf8')).upstreamVersion);
  } catch (error) { console.error(`[clawgod] ${error.message}`); process.exitCode = 1; }
}
