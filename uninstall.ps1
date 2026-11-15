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

foreach ($f in @("ast-helpers.mjs","patch-rules.mjs","pentest-prompts.mjs","prompt-runtime.cjs","cli.js","cli.cjs","cli.original.js","cli.original.cjs","cli.original.js.bak","cli.original.cjs.bak","source-backup.json","patch.js","patch.mjs","ast-patches.mjs","pentest-patches.mjs","pentest-scanners.mjs","pentest-trimming.mjs","pentest-policy-text.mjs","pentest-pruner.mjs","lean-mode.cjs","lean-settings.json",".lean-disabled",".lean-max","acorn.mjs","acorn.LICENSE","extract-natives.mjs","post-process.mjs","repatch.mjs","startup-check.cjs","startup-check.log","openai-proxy.cjs","feature-gates.cjs","runtime-helpers.cjs","bun-ant-shim.cjs","clawgod-import.exe","claude.staged.exe","claude.fallback.exe",".source-version","node_modules","bun-runtime","vendor","bunfs","pathmap.json")) {
    $p = Join-Path $ClawDir $f
    if (Test-Path $p) { Remove-Item -Recurse -Force $p }
}
Remove-Item -LiteralPath (Join-Path $ClawDir "compile-runtime.mjs"), (Join-Path $ClawDir ".compiled-runtime"), (Join-Path $ClawDir ".compiled-runtime-cache.json") -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $ClawDir "patch-registry.mjs"), (Join-Path $ClawDir "system-prompt.md"), (Join-Path $ClawDir "probe-tools.log"), (Join-Path $ClawDir ".clawgod-version") -Force -ErrorAction SilentlyContinue
Get-ChildItem -LiteralPath $ClawDir -Filter "cli.compiled-*" -File -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
Get-ChildItem -LiteralPath $ClawDir -Filter "claude.fallback.*.exe" -File -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
Write-OK "ClawGod_Y uninstalled"
Write-Host ""
Write-Dim "Restart your terminal for changes to take effect."
Write-Host ""
