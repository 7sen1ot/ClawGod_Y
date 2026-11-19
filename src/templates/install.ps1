#Requires -Version 5.1
param(
    [Parameter(Position = 0)]
    [ValidatePattern('^(latest|stable|[0-9]+\.[0-9]+\.[0-9]+)$')]
    [string]$Version = "2.1.322"
)

$ErrorActionPreference = "Stop"

$ClawDir = Join-Path $env:USERPROFILE ".clawgod"
$BinDir  = Join-Path $env:USERPROFILE ".local\bin"
$ClawSelfVersion = "0.0.0-dev"

function Write-OK($msg)   { Write-Host "  $([char]0x2713) $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "  $([char]0x2717) $msg" -ForegroundColor Red }
function Write-Warn($msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }
function Write-Dim($msg)  { Write-Host "  $msg" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "  ClawGod_Y Installer" -ForegroundColor White -NoNewline
Write-Host " (Windows)" -ForegroundColor DarkGray
Write-Host ""

$BunBin = $null
try { $BunBin = (Get-Command bun -ErrorAction Stop).Source } catch {}
if (-not $BunBin) {
    $homeBun = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
    if (Test-Path $homeBun) { $BunBin = $homeBun }
}
if (-not $BunBin) {
    Write-Dim "Installing Bun (sole runtime: patcher and CLI) ..."
    try {
        Invoke-Expression "$(Invoke-RestMethod https://bun.sh/install.ps1)" 2>$null | Out-Null
    } catch {}
    $BunBin = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
    if (-not (Test-Path $BunBin)) {
        Write-Err "Bun installation failed. Install manually: https://bun.sh/install"
        exit 1
    }
}

if ($BunBin -match '\.ps1$') {
    $resolved = $null
    $bunDir = Split-Path $BunBin

    foreach ($location in @(
        @($bunDir, "node_modules\bun\bin\bun.exe"),
        @($env:USERPROFILE, ".bun\bin\bun.exe"),
        @($env:USERPROFILE, "scoop\shims\bun.exe"),
        @($env:ProgramData, "chocolatey\bin\bun.exe")
    )) {
        $cand = Join-Path $location[0] $location[1]
        if (Test-Path $cand) { $resolved = $cand; break }
    }
    if ($resolved) {
        Write-Dim "Resolved bun.ps1 -> $resolved"
        $BunBin = $resolved
    } else {
        Write-Warn "Bun resolved to .ps1 wrapper ($BunBin). The launcher may not work."
        Write-Warn "Consider installing Bun via bun.sh/install.ps1 for a native bun.exe."
    }
}
$MinBunVersion = '1.3.14'
$BunVersionRaw = ''
try {
    $bunOut = & $BunBin --version 2>$null | Select-Object -First 1
    if ($bunOut) { $BunVersionRaw = "$bunOut".Trim() }
} catch {}
Write-OK "Bun: $BunVersionRaw"
$BunVersionNum = ($BunVersionRaw -split '-')[0]
$BunVersionOk = $false
try {
    if ($BunVersionNum) {
        $BunVersionOk = ([version]$BunVersionNum) -ge ([version]$MinBunVersion)
    }
} catch {}
if (-not $BunVersionOk) {
    Write-Err "Bun $MinBunVersion or later is required (found $BunVersionRaw). Use bun upgrade or update Bun with your package manager."
    exit 1
}

try {
    $rgPath = (Get-Command rg -ErrorAction Stop).Source
    Write-OK "ripgrep: $rgPath"
}
catch {
    Write-Err "ripgrep (rg) is required but not found in PATH."
    Write-Err "  ClawGod_Y's Grep tool will not function without it."
    Write-Err ""
    Write-Err "  Install: winget install BurntSushi.ripgrep.MSVC"
    Write-Err "       or: scoop install ripgrep"
    Write-Err "       or: choco install ripgrep"
    Write-Err ""
    Write-Err "  Re-run this script after installing rg."
    exit 1
}

New-Item -ItemType Directory -Force -Path $ClawDir | Out-Null
New-Item -ItemType Directory -Force -Path $BinDir  | Out-Null

$NativeBin = $null

if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64" -or $env:PROCESSOR_ARCHITEW6432 -eq "ARM64") {
    $arch = "arm64"
} else {
    $arch = "x64"
}
$platformSuffix = "win32-$arch"


$npmPkg = "@anthropic-ai/claude-code-$platformSuffix"
Write-Dim "Fetching $npmPkg@$Version from npm registry ..."
$NativeBinTmpDir = Join-Path $env:TEMP "clawgod-binary-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $NativeBinTmpDir | Out-Null
$fetchScript = Join-Path $NativeBinTmpDir "fetch.mjs"
@'
{{CLAWGOD:npm-fetch.mjs}}
'@ | Set-Content $fetchScript -Encoding UTF8

$output = & $BunBin $fetchScript "$npmPkg@$Version" $NativeBinTmpDir 2>&1
$exitCode = $LASTEXITCODE
$output | ForEach-Object { Write-Host "  $_" }
Remove-Item -Force $fetchScript -ErrorAction SilentlyContinue

if ($exitCode -ne 0) {
    Remove-Item -Recurse -Force $NativeBinTmpDir -ErrorAction SilentlyContinue
    Write-Err "Fetch failed (bun exit $exitCode). Install the official binary manually:"
    Write-Err "    irm https://claude.ai/install.ps1 | iex"
    exit 1
}

$cand = Join-Path $NativeBinTmpDir "package\claude.exe"
if ((Test-Path $cand) -and (Get-Item $cand).Length -gt 10MB) {
    $NativeBin = $cand
    $verLine = $output | Where-Object { $_ -match '^VERSION=' } | Select-Object -First 1
    if ($verLine) { $NativeBinLabel = ($verLine -replace '^VERSION=', '').Trim() }
    else { $NativeBinLabel = "npm-latest" }
} else {
    Remove-Item -Recurse -Force $NativeBinTmpDir -ErrorAction SilentlyContinue
    Write-Err "Tarball downloaded but expected package\claude.exe was missing or too small."
    exit 1
}
Write-OK "Downloaded $npmPkg@$NativeBinLabel"

$RollbackDir = $null
$script:RollbackPending = $false
$RollbackFiles = @(
{{CLAWGOD:rollback-files}}
)
$origCjs = Join-Path $ClawDir "cli.original.cjs"
$sourceVerFile = Join-Path $ClawDir ".source-version"
if ((Test-Path $origCjs) -and (Test-Path $sourceVerFile)) {
    $RollbackDir = Join-Path (Split-Path -Parent $ClawDir) (".clawgod-rollback-" + [System.Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $RollbackDir -Force | Out-Null
    $movedRollbackFiles = @()
    try {
        foreach ($f in $RollbackFiles) {
            $path = Join-Path $ClawDir $f
            if (-not (Test-Path -LiteralPath $path)) { continue }
            if ($f -in @("bunfs", "vendor", "source-backup.json")) {
                try {
                    Move-Item -LiteralPath $path -Destination (Join-Path $RollbackDir $f) -ErrorAction Stop
                    $movedRollbackFiles += $f
                    continue
                } catch { }
            }
            Copy-Item -LiteralPath $path -Destination $RollbackDir -Recurse -Force -ErrorAction Stop
        }
    } catch {
        $snapshotError = $_
        $restoreFailed = $false
        foreach ($f in $movedRollbackFiles) {
            try {
                Move-Item -LiteralPath (Join-Path $RollbackDir $f) -Destination (Join-Path $ClawDir $f) -ErrorAction Stop
            } catch { $restoreFailed = $true }
        }
        if ($restoreFailed) { throw "Could not snapshot existing installation; recovery backup kept at $RollbackDir : $snapshotError" }
        Remove-Item -LiteralPath $RollbackDir -Recurse -Force -ErrorAction SilentlyContinue
        throw "Could not snapshot existing installation; previous files restored: $snapshotError"
    }
}

function Restore-Install {
    Remove-Item -LiteralPath (Join-Path $ClawDir "claude.staged.exe") -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $ClawDir "uninstall.ps1.tmp"), (Join-Path $BinDir "clawgod.cmd.tmp") -Force -ErrorAction SilentlyContinue
    if (-not $script:RollbackPending) { return }
    $script:RollbackPending = $false
    if (-not $RollbackDir) { return }
    Write-Dim "Rolling back to previous working installation ..."
    try {
        foreach ($f in $RollbackFiles) {
            $path = Join-Path $ClawDir $f
            if (Test-Path $path) { Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop }
        }
        Get-ChildItem -LiteralPath $RollbackDir -Force | Move-Item -Destination $ClawDir -Force -ErrorAction Stop
        Write-OK "Restored previous working installation ($((Get-Content $sourceVerFile -Raw).Trim()))."
        Remove-Item -LiteralPath $RollbackDir -Recurse -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Err "Rollback failed; backup kept at $RollbackDir : $_"
    }
}
$script:RollbackPending = $true
trap { Restore-Install; break }

$extractorPath = Join-Path $ClawDir "extract-natives.mjs"
@'
{{CLAWGOD:extract-natives.mjs}}
'@ | Set-Content $extractorPath -Encoding UTF8

$VendorDir = Join-Path $ClawDir "vendor"
if (Test-Path $VendorDir) { Remove-Item -Recurse -Force $VendorDir }

$BunfsDir = Join-Path $ClawDir "bunfs"
if (Test-Path $BunfsDir) { Remove-Item -Recurse -Force $BunfsDir }
$PathMap = Join-Path $ClawDir "pathmap.json"
if (Test-Path $PathMap) { Remove-Item -Force $PathMap }

$dstCli = Join-Path $ClawDir "cli.original.js"
if (Test-Path $dstCli) { Remove-Item -Force $dstCli }

Write-Dim "Extracting cli.js + napi modules from $NativeBinLabel ..."
& $BunBin $extractorPath $NativeBin $ClawDir 2>&1 | ForEach-Object { Write-Host "  $_" }
if (($LASTEXITCODE -ne 0) -or -not (Test-Path $dstCli)) {
    Write-Err "Failed to extract cli.js from native binary"
    Restore-Install
    exit 1
}

Write-Dim "Rewriting bunfs paths and IIFE invocation ..."
$postProc = Join-Path $ClawDir "post-process.mjs"
@'
{{CLAWGOD:post-process.mjs}}
'@ | Set-Content $postProc -Encoding UTF8
@'
{{CLAWGOD:openai-proxy.cjs}}
'@ | Set-Content (Join-Path $ClawDir "openai-proxy.cjs") -Encoding UTF8
Write-OK "OpenAI-compatible proxy created (openai-proxy.cjs)"

@'
{{CLAWGOD:feature-gates.cjs}}
'@ | Set-Content (Join-Path $ClawDir "feature-gates.cjs") -Encoding UTF8
Write-OK "Patch feature gates created (feature-gates.cjs)"

@'
{{CLAWGOD:cli.cjs}}
'@ | Set-Content (Join-Path $ClawDir "cli.cjs") -Encoding UTF8
Set-Content (Join-Path $ClawDir ".clawgod-version") $ClawSelfVersion
Write-OK "Wrapper created (cli.cjs)"

@'
{{CLAWGOD:startup-check.cjs}}
'@ | Set-Content (Join-Path $ClawDir "startup-check.cjs") -Encoding UTF8

@'
{{CLAWGOD:runtime-helpers.cjs}}
'@ | Set-Content (Join-Path $ClawDir "runtime-helpers.cjs") -Encoding UTF8
@'
{{CLAWGOD:prompt-runtime.cjs}}
'@ | Set-Content (Join-Path $ClawDir "prompt-runtime.cjs") -Encoding UTF8
Write-OK "Classifier helper created (runtime-helpers.cjs)"

@'
{{CLAWGOD:bun-ant-shim.cjs}}
'@ | Set-Content (Join-Path $ClawDir "bun-ant-shim.cjs") -Encoding UTF8
Write-OK "Bun.ant runtime shim created (bun-ant-shim.cjs)"

@'
{{CLAWGOD:compile-runtime.mjs}}
'@ | Set-Content (Join-Path $ClawDir "compile-runtime.mjs") -Encoding UTF8

@'
{{CLAWGOD:acorn.mjs}}
'@ | Set-Content (Join-Path $ClawDir "acorn.mjs") -Encoding UTF8
@'
{{CLAWGOD:acorn.LICENSE}}
'@ | Set-Content (Join-Path $ClawDir "acorn.LICENSE") -Encoding UTF8

@'
{{CLAWGOD:ast-helpers.mjs}}
'@ | Set-Content (Join-Path $ClawDir "ast-helpers.mjs") -Encoding UTF8

& $BunBin $postProc 2>&1 | ForEach-Object { Write-Host "  $_" }
if (($LASTEXITCODE -ne 0) -or -not (Test-Path (Join-Path $ClawDir "cli.original.cjs"))) {
    Write-Err "Post-process failed"
    Restore-Install
    exit 1
}

Set-Content -Path (Join-Path $ClawDir ".source-version") -Value $NativeBinLabel -Encoding ASCII

if ($NativeBin -and (Test-Path $NativeBin)) {
    Move-Item -Force $NativeBin (Join-Path $ClawDir "claude.staged.exe")
}

if ($NativeBinTmpDir -and (Test-Path $NativeBinTmpDir)) {
    Remove-Item -Recurse -Force $NativeBinTmpDir -ErrorAction SilentlyContinue
}

Write-OK "cli.original.cjs ready ($NativeBinLabel)"

@'
{{CLAWGOD:ast-patches.mjs}}
'@ | Set-Content (Join-Path $ClawDir "ast-patches.mjs") -Encoding UTF8
@'
{{CLAWGOD:pentest-patches.mjs}}
'@ | Set-Content (Join-Path $ClawDir "pentest-patches.mjs") -Encoding UTF8

@'
{{CLAWGOD:pentest-scanners.mjs}}
'@ | Set-Content (Join-Path $ClawDir "pentest-scanners.mjs") -Encoding UTF8
@'
{{CLAWGOD:pentest-prompts.mjs}}
'@ | Set-Content (Join-Path $ClawDir "pentest-prompts.mjs") -Encoding UTF8
@'
{{CLAWGOD:pentest-trimming.mjs}}
'@ | Set-Content (Join-Path $ClawDir "pentest-trimming.mjs") -Encoding UTF8
@'
{{CLAWGOD:pentest-policy-text.mjs}}
'@ | Set-Content (Join-Path $ClawDir "pentest-policy-text.mjs") -Encoding UTF8
@'
{{CLAWGOD:pentest-pruner.mjs}}
'@ | Set-Content (Join-Path $ClawDir "pentest-pruner.mjs") -Encoding UTF8
@'
{{CLAWGOD:lean-mode.cjs}}
'@ | Set-Content (Join-Path $ClawDir "lean-mode.cjs") -Encoding UTF8

$systemPromptEscaped = @'
{{CLAWGOD:system-prompt.md}}
'@
$systemPromptText = [Regex]::Replace($systemPromptEscaped, '\\u([0-9a-fA-F]{4})', { param($m) [char]([Convert]::ToInt32($m.Groups[1].Value, 16)) }) -join ''
Set-Content (Join-Path $ClawDir "system-prompt.md") $systemPromptText -Encoding UTF8

@'
{{CLAWGOD:patch-rules.mjs}}
'@ | Set-Content (Join-Path $ClawDir "patch-rules.mjs") -Encoding UTF8
$patcherCode = @'
{{CLAWGOD:patch.mjs}}
'@
$patchRegistryCode = @'
{{CLAWGOD:patch-registry.mjs}}
'@

Set-Content (Join-Path $ClawDir "patch.mjs") $patcherCode -Encoding UTF8
Set-Content (Join-Path $ClawDir "patch-registry.mjs") $patchRegistryCode -Encoding UTF8
Write-OK "Patcher created (patch.mjs)"


Write-Dim "Applying patches ..."
$patchExitCode = & {
    $ErrorActionPreference = 'Continue'
    & $BunBin (Join-Path $ClawDir "patch.mjs") --capture-and-apply 2>&1 | ForEach-Object { Write-Host "  $_" }
    $LASTEXITCODE
}
if ($patchExitCode -ne 0) {
    $exitCode = $patchExitCode
    Write-Err "Patching failed (bun exit $exitCode). Installation aborted."
    Restore-Install
    if (-not $RollbackDir) {
        Write-Err "No previous working installation found to roll back."
    }
    Write-Err ""
    Write-Err "The selected upstream runtime build ($NativeBinLabel) is not supported by this ClawGod_Y release."
    Write-Err "Optional unmatched patches are already skipped; required prompt injection and source errors cannot be skipped."
    Write-Err "Rerun the installer with a compatible upstream runtime version."
    exit $exitCode
}

Write-Dim "Compiling startup runtime ..."
& {
    $ErrorActionPreference = 'Continue'
    & $BunBin (Join-Path $ClawDir "compile-runtime.mjs") 2>&1 | ForEach-Object { Write-Host "  $_" }
    $script:compileExitCode = $LASTEXITCODE
}
if ($compileExitCode -ne 0) { Restore-Install; exit $compileExitCode }

$bunfsDir = Join-Path $ClawDir "bunfs"
$targets = @()
if (Test-Path $bunfsDir) {
    $targets += Get-ChildItem -Path $bunfsDir -File -ErrorAction SilentlyContinue
}
$entry = Join-Path $ClawDir "cli.original.cjs"
if (Test-Path $entry) { $targets += Get-Item $entry }

$hit = $targets |
    Select-String -Pattern 'Bun\.ant\.CellSegmenter' -List -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($hit) {
    Write-Dim "Renderer runtime: Bun.ant.CellSegmenter (Claude >= 2.1.271) - served by bun-ant-shim.cjs"
} else {
    Write-Dim "Renderer runtime: stock Bun APIs (shim present but unused)"
}

$featuresFile = Join-Path $ClawDir "features.json"
if (-not (Test-Path $featuresFile)) {
    $featuresJson = @'
{{CLAWGOD:features.json}}
'@
    [System.IO.File]::WriteAllText($featuresFile, $featuresJson, (New-Object System.Text.UTF8Encoding $false))
    Write-OK "Default features.json created"
}

$patchesFile = Join-Path $ClawDir "patches.json"
if (-not (Test-Path $patchesFile)) {
    [System.IO.File]::WriteAllText($patchesFile, "{}`r`n", (New-Object System.Text.UTF8Encoding $false))
    Write-OK "Default patches.json created (all features on)"
}

$providerFile = Join-Path $ClawDir "provider.json"
if (-not (Test-Path $providerFile)) {
    $providerJson = @'
{
  "protocol": "anthropic",
  "apiKey": "",
  "baseURL": "https://api.anthropic.com",
  "model": "",
  "smallModel": "",
  "effort": "",
  "timeoutMs": 3000000
}
'@
    [System.IO.File]::WriteAllText($providerFile, $providerJson, (New-Object System.Text.UTF8Encoding $false))
}

$leanSettings = Join-Path $ClawDir "lean-settings.json"

foreach ($legacyFlag in @(".lean-disabled", ".lean-max")) {
    $legacyPath = Join-Path $ClawDir $legacyFlag
    if (Test-Path $legacyPath) { Remove-Item $legacyPath -Force }
}

$leanApplyScript = @'
{{CLAWGOD:lean-apply.cjs}}
'@
try {
    & $BunBin -e $leanApplyScript (Join-Path $ClawDir "lean-mode.cjs") "$leanSettings" (Join-Path $ClawDir "patches.json") 2>$null
    Write-OK "Lean settings applied (strictest, clawgod-scoped): ~\.clawgod\lean-settings.json"
} catch {}

Write-Dim "Verifying Bun can load patched cli.original.cjs (bounded startup check) ..."
$sanityCli = Join-Path $ClawDir "cli.cjs"
function Invoke-StartupProbe {
    $ErrorActionPreference = 'Continue'
    try {
        $output = (& $BunBin (Join-Path $ClawDir "startup-check.cjs") $BunBin $sanityCli @args 2>&1 | Out-String)
        return @{ Output = $output; ExitCode = $LASTEXITCODE }
    } catch {
        return @{ Output = "$_"; ExitCode = 1 }
    }
}
$sanity = Invoke-StartupProbe
$sanityOut = $sanity.Output
$sanityExitCode = $sanity.ExitCode
if ($sanityOut -match "Expected CommonJS module to have a function wrapper") {
    Write-Err "Bun $BunVersionRaw could not load this CLI. Use bun upgrade or update Bun with your package manager."
    Restore-Install
    exit 1
}
if ($sanityExitCode -ne 0) {
    Write-Host ""
    Write-Err "Patched Claude failed its startup check (exit $sanityExitCode):"
    Write-Err "$sanityOut"
    Restore-Install
    exit $sanityExitCode
}
Write-OK "Bun loads cli.original.cjs"
Write-Dim "Verifying tool/command tables load (bounded probe) ..."
$probe = Invoke-StartupProbe --probe-tools
$probeOut = $probe.Output
$probeExitCode = $probe.ExitCode
if ($probeExitCode -ne 0) {
    Write-Host ""
    Write-Err "Patched Claude failed its tool-table probe (exit $probeExitCode):"
    Write-Err "$probeOut"
    Restore-Install
    exit $probeExitCode
}
Write-OK "Tool and command tables load cleanly"


$cliPathInCmd = "%USERPROFILE%\.clawgod\cli.cjs"
$normalizedUserProfile = $env:USERPROFILE.TrimEnd('\', '/')
$normalizedBunBin = $BunBin.TrimEnd('\', '/')
$userProfilePrefix = "$normalizedUserProfile\"
if ($normalizedBunBin.Equals($normalizedUserProfile, [StringComparison]::OrdinalIgnoreCase) -or
    $normalizedBunBin.StartsWith($userProfilePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    $bunRelative = $normalizedBunBin.Substring($normalizedUserProfile.Length).TrimStart('\', '/')
    $bunPathInCmd = "%USERPROFILE%\$bunRelative"
} else {

    $bunPathInCmd = $BunBin
}

$claudeExeForPath = Join-Path $ClawDir "claude.fallback.exe"
$stagedFallback = Join-Path $ClawDir "claude.staged.exe"
if (Test-Path $stagedFallback) {
    if (Test-Path $claudeExeForPath) {
        try {
            Remove-Item -LiteralPath $claudeExeForPath -Force -ErrorAction Stop
        } catch {
            $retiredFallback = Join-Path $ClawDir ("claude.fallback." + [Guid]::NewGuid().ToString('N') + ".exe")
            Move-Item -LiteralPath $claudeExeForPath -Destination $retiredFallback -ErrorAction Stop
        }
    }
    Move-Item -LiteralPath $stagedFallback -Destination $claudeExeForPath -Force
    Write-OK "Native execPath refreshed for the selected Claude version (claude.fallback.exe)"
}
if (-not (Test-Path -LiteralPath $claudeExeForPath -PathType Leaf)) { throw 'Selected Claude native executable is missing' }
$normalizedClaudeExe = $claudeExeForPath.TrimEnd('\', '/')
if ($normalizedClaudeExe.StartsWith($userProfilePrefix, [StringComparison]::OrdinalIgnoreCase)) {
    $claudeExeInCmd = "%USERPROFILE%\" + $normalizedClaudeExe.Substring($normalizedUserProfile.Length).TrimStart('\', '/')
} else {
    $claudeExeInCmd = $claudeExeForPath
}

$importBin = Join-Path $ClawDir "clawgod-import.exe"
if (-not (Test-Path $importBin)) {
    $importUrl = "https://github.com/7sen1ot/ClawGod_Y/releases/latest/download/clawgod-import-windows-x64.exe"
    try {
        Invoke-WebRequest -Uri $importUrl -OutFile $importBin -UseBasicParsing -ErrorAction Stop
        Write-OK "Provider import tool installed (clawgod-import.exe)"
    } catch {
        Write-Dim "Provider import tool not yet available (build pending)"
    }
}

$importPathInCmd = "%USERPROFILE%\.clawgod\clawgod-import.exe"
$launcherContent = "@echo off`r`nif `"%~1`"==`"import`" (`r`n  if exist `"$importPathInCmd`" (`r`n    shift`r`n    `"$importPathInCmd`" %1 %2 %3 %4 %5 %6 %7 %8 %9`r`n    exit /b %ERRORLEVEL%`r`n  ) else (`r`n    echo clawgod: import tool not installed. Reinstall clawgod to get it.`r`n    exit /b 127`r`n  )`r`n)`r`nif not exist `"$cliPathInCmd`" (`r`n  echo clawgod: cli.cjs not found. Reinstall: irm https://github.com/7sen1ot/ClawGod_Y/releases/latest/download/install.ps1 ^| iex`r`n  exit /b 127`r`n)`r`nif not exist `"$bunPathInCmd`" (`r`n  echo clawgod: bun not found at $bunPathInCmd. Install: https://bun.sh/install`r`n  exit /b 127`r`n)`r`nset `"CLAUDE_CODE_EXECPATH=$claudeExeInCmd`"`r`nif not defined IS_SANDBOX set `"IS_SANDBOX=1`"`r`n`"$bunPathInCmd`" `"$cliPathInCmd`" %*"

$sourceLaunch = "`"$bunPathInCmd`" `"$cliPathInCmd`" %*"
$compiledLaunch = @"
if "%~1"=="--uninstall" goto source
if not exist "%USERPROFILE%\.clawgod\.compiled-runtime" goto source
set "CLAWGOD_COMPILED="
set /p "CLAWGOD_COMPILED="<"%USERPROFILE%\.clawgod\.compiled-runtime"
if not exist "%USERPROFILE%\.clawgod\%CLAWGOD_COMPILED%" goto source
"%USERPROFILE%\.clawgod\%CLAWGOD_COMPILED%" %*
exit /b %ERRORLEVEL%
:source
$sourceLaunch
"@
$launcherContent = $launcherContent.Replace($sourceLaunch, $compiledLaunch)
$launcherContent | Set-Content (Join-Path $BinDir "clawgod.cmd.tmp") -Encoding Default

[IO.File]::WriteAllBytes((Join-Path $ClawDir "uninstall.ps1.tmp"), [Convert]::FromBase64String('{{CLAWGOD:standalone-uninstaller}}'))
if (-not (Test-Path -LiteralPath (Join-Path $ClawDir "uninstall.ps1.tmp") -PathType Leaf) -or
    (Get-Item -LiteralPath (Join-Path $ClawDir "uninstall.ps1.tmp")).Length -eq 0) { throw 'Uninstaller is missing or empty' }
Move-Item -LiteralPath (Join-Path $ClawDir "uninstall.ps1.tmp") -Destination (Join-Path $ClawDir "uninstall.ps1") -Force

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$BinDir;$userPath", "User")
    $env:Path = "$BinDir;$env:Path"
    Write-OK "Added $BinDir to user PATH"
    Write-Dim "(restart terminal for PATH to take effect)"
}
if (Test-Path -LiteralPath (Join-Path $BinDir "clawgod.cmd") -PathType Container) { throw 'Launcher target is a directory' }
Move-Item -LiteralPath (Join-Path $BinDir "clawgod.cmd.tmp") -Destination (Join-Path $BinDir "clawgod.cmd") -Force -ErrorAction Stop
$script:RollbackPending = $false
if ($RollbackDir) { Remove-Item -LiteralPath $RollbackDir -Recurse -Force -ErrorAction SilentlyContinue }
Write-OK "Command 'clawgod' -> patched; 'claude' untouched"
$compiledName = $null
if (Test-Path (Join-Path $ClawDir ".compiled-runtime")) {
    $compiledName = (Get-Content -LiteralPath (Join-Path $ClawDir ".compiled-runtime") -Raw).Trim()
}
Get-ChildItem -LiteralPath $ClawDir -Filter "cli.compiled-*" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne $compiledName } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }

foreach ($leftover in @("claude.orig.cmd", "claude.orig.exe", "claude.cmd")) {
    $p = Join-Path $BinDir $leftover
    if ((Test-Path $p) -and ($leftover -ne "claude.cmd" -or
        (Select-String -LiteralPath $p -Pattern '\.clawgod[\\/]cli\.(?:cjs|js)' -Quiet -ErrorAction SilentlyContinue))) {
        Remove-Item -Force $p -ErrorAction SilentlyContinue
    }
}
Get-ChildItem $BinDir -Filter "claude.*.exe" -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
Remove-Item -Force (Join-Path $ClawDir "claude.staged.exe") -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $ClawDir "install.ps1") -Force -ErrorAction SilentlyContinue
Get-ChildItem -LiteralPath $ClawDir -Filter "claude.fallback.*.exe" -File -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }

Write-Host ""
Write-Host "  ClawGod_Y installed!" -ForegroundColor Green
Write-Host ""
Write-Dim "  clawgod           -- Start ClawGod_Y"
Write-Dim "  claude            -- Original upstream CLI (untouched)"
Write-Host ""
Write-Dim "  ClawGod_Y runtime version: $NativeBinLabel"
Write-Dim "  clawgod --version   -- Query the ClawGod_Y runtime version"
Write-Dim "  clawgod --uninstall -- Uninstall ClawGod_Y"
Write-Dim "  Vanilla 'claude update' keeps working and updates only the original."
Write-Host ""
Write-Dim "  If 'clawgod' is not found, restart your terminal."
Write-Host ""
Write-Dim "  Config: ~/.clawgod/provider.json"
Write-Dim "  Flags:  ~/.clawgod/features.json"
Write-Host ""
