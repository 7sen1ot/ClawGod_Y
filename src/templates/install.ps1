#Requires -Version 5.1
param([string]$Version)
$ErrorActionPreference = 'Stop'
$ClawRelease = 'latest'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$bun = Get-Command bun -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
if (-not $bun) { $bun = Join-Path $env:USERPROFILE '.bun\bin\bun.exe' }
if (-not (Test-Path -LiteralPath $bun)) {
    Invoke-RestMethod https://bun.sh/install.ps1 | Invoke-Expression
    $bun = Join-Path $env:USERPROFILE '.bun\bin\bun.exe'
}
if ($ClawRelease -eq 'latest') { $ClawRelease = (Invoke-RestMethod https://api.github.com/repos/7sen1ot/ClawGod_Y/releases/latest).tag_name }
if ($ClawRelease -notmatch '^v[0-9][0-9A-Za-z.-]*$') { throw 'Invalid release tag' }
$base = "https://github.com/7sen1ot/ClawGod_Y/releases/download/$ClawRelease"
$work = Join-Path ([IO.Path]::GetTempPath()) ('clawgod-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    $archive = Join-Path $work 'clawgod-runtime.tar.gz'
    Invoke-WebRequest "$base/clawgod-runtime.tar.gz" -OutFile $archive -UseBasicParsing
    $sums = (Invoke-WebRequest "$base/SHA256SUMS" -UseBasicParsing).Content
    if ($sums -notmatch '(?m)^([a-f0-9]{64})  clawgod-runtime\.tar\.gz\r?$') { throw 'Missing runtime checksum' }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ine $Matches[1]) { throw 'Runtime SHA-256 mismatch' }
    & tar.exe -xzf $archive -C $work
    if ($LASTEXITCODE -ne 0) { throw 'Runtime extraction failed' }
    $runtime = Join-Path $work 'install-runtime.mjs'
    if ($Version) { & $bun $runtime $Version } else { & $bun $runtime }
    if ($LASTEXITCODE -ne 0) { throw "Installation failed (exit $LASTEXITCODE)" }
} finally { Remove-Item -LiteralPath $work -Recurse -Force }
