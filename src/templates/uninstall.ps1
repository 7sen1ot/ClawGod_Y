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
{{CLAWGOD:uninstall-files}}
)) {
    $path = Join-Path $ClawDir $file
    if (Test-Path -LiteralPath $path -PathType Leaf) { Remove-Item -LiteralPath $path -Force }
}
foreach ($dir in @(
{{CLAWGOD:uninstall-dirs}}
)) {
    $path = Join-Path $ClawDir $dir
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}
foreach ($file in @(
{{CLAWGOD:uninstall-best-effort-files}}
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
