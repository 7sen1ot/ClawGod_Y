#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
$bun = Get-Command bun -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
if (-not $bun) { $bun = Join-Path $env:USERPROFILE '.bun\bin\bun.exe' }
$runtime = Join-Path $env:USERPROFILE '.clawgod\install-runtime.mjs'
if (Test-Path -LiteralPath $runtime) {
    & $bun $runtime --uninstall
    if ($LASTEXITCODE -ne 0) { throw "Uninstall failed (exit $LASTEXITCODE)" }
} else {
    $bootstrap = (Invoke-WebRequest https://github.com/7sen1ot/ClawGod_Y/releases/latest/download/install.ps1 -UseBasicParsing).Content
    & ([scriptblock]::Create($bootstrap)) '--uninstall'
}
