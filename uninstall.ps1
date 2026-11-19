#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$ClawDir = Join-Path $env:USERPROFILE ".clawgod"
$BinDir = Join-Path $env:USERPROFILE ".local\bin"

function Write-OK($msg) { Write-Host "  $([char]0x2713) $msg" -ForegroundColor Green }
function Write-Dim($msg) { Write-Host "  $msg" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "  ClawGod_Y Uninstaller" -ForegroundColor White -NoNewline
Write-Host " (Windows)" -ForegroundColor DarkGray
Write-Host ""

$clawgodCmd = Join-Path $BinDir "clawgod.cmd"
if (Test-Path $clawgodCmd) {
    Remove-Item -Force $clawgodCmd
    Write-OK "Removed ClawGod_Y launcher"
}
foreach ($leftover in @("claude.orig.cmd", "claude.orig.exe")) {
    $p = Join-Path $BinDir $leftover
    if (Test-Path $p) { Remove-Item -Force $p }
}

foreach ($file in @(
    'extract-natives.mjs'
    'post-process.mjs'
    'openai-proxy.cjs'
    'cli.cjs'
    'startup-check.cjs'
    'runtime-helpers.cjs'
    'prompt-runtime.cjs'
    'bun-ant-shim.cjs'
    'feature-gates.cjs'
    'patch.mjs'
    'patch-rules.mjs'
    'ast-patches.mjs'
    'ast-helpers.mjs'
    'pentest-patches.mjs'
    'pentest-scanners.mjs'
    'pentest-prompts.mjs'
    'pentest-trimming.mjs'
    'pentest-policy-text.mjs'
    'pentest-pruner.mjs'
    'lean-mode.cjs'
    'npm-fetch.mjs'
    'acorn.mjs'
    'acorn.LICENSE'
    'cli.original.cjs'
    'cli.original.cjs.bak'
    'cli.original.js'
    '.source-version'
    'source-backup.json'
    'pathmap.json'
    'lean-settings.json'
    'claude.fallback.exe'
    'cli.original.js.bak'
    'cli.js'
    'patch.js'
    'repatch.mjs'
    '.lean-disabled'
    '.lean-max'
    'startup-check.log'
    'clawgod-import.exe'
    'claude.staged.exe'
)) {
    $path = Join-Path $ClawDir $file
    if (Test-Path -LiteralPath $path -PathType Leaf) { Remove-Item -LiteralPath $path -Force }
}
foreach ($dir in @(
    'bunfs'
    'vendor'
    'node_modules'
    'bun-runtime'
)) {
    $path = Join-Path $ClawDir $dir
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}
foreach ($file in @(
    'compile-runtime.mjs'
    'patch-registry.mjs'
    'system-prompt.md'
    '.clawgod-version'
    '.compiled-runtime'
    '.compiled-runtime-cache.json'
    'probe-tools.log'
)) {
    Remove-Item -LiteralPath (Join-Path $ClawDir $file) -Force -ErrorAction SilentlyContinue
}
Get-ChildItem -LiteralPath $ClawDir -Filter "cli.compiled-*" -File -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
Get-ChildItem -LiteralPath $ClawDir -Filter "claude.fallback.*.exe" -File -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
Write-OK "ClawGod_Y uninstalled"
Write-Host ""
Write-Dim "Restart your terminal for changes to take effect."
Write-Host ""
