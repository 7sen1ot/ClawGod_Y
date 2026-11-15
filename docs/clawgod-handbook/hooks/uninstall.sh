#!/usr/bin/env bash
# ClawGod Handbook — Hook 卸载脚本
# 用法：bash uninstall.sh
# 移除 Hook 配置和脚本，保留 rules 和审计日志。

set -e

HOOKS_DST="$HOME/.claude/hooks"
SETTINGS="$HOME/.claude/settings.json"

GREEN='\033[0;32m'
DIM='\033[2m'
NC='\033[0m'
info() { echo -e "  ${GREEN}✓${NC} $1"; }
dim()  { echo -e "  ${DIM}$1${NC}"; }

echo ""
echo "  ClawGod Handbook — Hook 卸载器"
echo ""

# 从 settings.json 移除 hook 配置
if [ -f "$SETTINGS" ]; then
    python3 -c "
import json, sys
with open('$SETTINGS', 'r') as f:
    s = json.load(f)
changed = False
for evt in ['UserPromptSubmit', 'PreToolUse']:
    if 'hooks' in s and evt in s['hooks']:
        s['hooks'][evt] = [h for h in s['hooks'][evt]
                           if 'scene-router' not in h.get('command','')
                           and 'tool-guard' not in h.get('command','')]
        if not s['hooks'][evt]:
            del s['hooks'][evt]
        changed = True
if 'hooks' in s and not s['hooks']:
    del s['hooks']
if changed:
    with open('$SETTINGS', 'w') as f:
        json.dump(s, f, indent=2, ensure_ascii=False)
    print('cleaned')
else:
    print('no_change')
" 2>/dev/null && info "Hook 配置已从 settings.json 移除" || dim "settings.json 未变更"
fi

# 移除 hook 脚本
for f in scene-router.py tool-guard.py; do
    if [ -f "$HOOKS_DST/$f" ]; then
        rm "$HOOKS_DST/$f"
        info "已移除 $f"
    fi
done

echo ""
info "卸载完成"
echo ""
