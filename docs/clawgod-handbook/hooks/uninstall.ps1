#Requires -Version 5.1
<#
.SYNOPSIS
    ClawGod Handbook Hook 卸载器 (Windows)
.DESCRIPTION
    移除 scene-router 和 tool-guard hook 的脚本和 settings.json 注册项。
    保留 rules 和审计日志。
.EXAMPLE
    .\uninstall.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$HooksDst = Join-Path $env:USERPROFILE ".claude\hooks"
$Settings = Join-Path $env:USERPROFILE ".claude\settings.json"

function Write-OK($msg) { Write-Host "  ✓ $msg" -ForegroundColor Green }

Write-Host ""
Write-Host "  ClawGod Handbook — Hook 卸载器" -ForegroundColor White
Write-Host ""

# 移除 hook 脚本
foreach ($f in @("scene-router.py", "tool-guard.py")) {
    $p = Join-Path $HooksDst $f
    if (Test-Path $p) { Remove-Item $p -Force; Write-OK "已移除 $f" }
}

# 清理 settings.json
if (Test-Path $Settings) {
    $s = Get-Content $Settings -Raw | ConvertFrom-Json
    $changed = $false
    foreach ($evt in @("UserPromptSubmit", "PreToolUse")) {
        if ($s.hooks.PSObject.Properties.Name -contains $evt) {
            $arr = @($s.hooks.$evt | Where-Object {
                $_.command -notmatch "scene-router" -and $_.command -notmatch "tool-guard"
            })
            if ($arr.Count -eq 0) {
                $s.hooks.PSObject.Properties.Remove($evt)
            } else {
                $s.hooks.$evt = $arr
            }
            $changed = $true
        }
    }
    if ($changed) {
        $s | ConvertTo-Json -Depth 10 | Set-Content $Settings -Encoding UTF8
        Write-OK "Hook 配置已从 settings.json 移除"
    }
}

Write-Host ""
Write-OK "卸载完成"
Write-Host ""
