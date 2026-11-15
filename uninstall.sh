#!/bin/bash
set -e

CLAWGOD_DIR="$HOME/.clawgod"
BIN_DIR="$HOME/.local/bin"

GREEN='\033[0;32m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

info() { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${RED}✗${NC} $1"; }

echo ""
echo -e "${BOLD}  ClawGod_Y Uninstaller${NC}"
echo ""

CLAUDE_BIN=$(command -v claude 2>/dev/null || true)
for DIR in "${CLAUDE_BIN:+$(dirname "$CLAUDE_BIN")}" "$BIN_DIR"; do
  [ -z "$DIR" ] && continue
  if [ -f "$DIR/clawgod" ] && grep -q "clawgod" "$DIR/clawgod" 2>/dev/null; then
    rm -f "$DIR/clawgod"
    info "Removed ClawGod_Y launcher ($DIR/clawgod)"
  fi
done
rm -rf "$CLAWGOD_DIR/node_modules" "$CLAWGOD_DIR/vendor" "$CLAWGOD_DIR/bun-runtime" "$CLAWGOD_DIR/cli.original.js" "$CLAWGOD_DIR/cli.original.js.bak" "$CLAWGOD_DIR/cli.original.cjs" "$CLAWGOD_DIR/cli.original.cjs.bak" "$CLAWGOD_DIR/source-backup.json" "$CLAWGOD_DIR/cli.js" "$CLAWGOD_DIR/cli.cjs" "$CLAWGOD_DIR/patch.mjs" "$CLAWGOD_DIR/ast-patches.mjs" "$CLAWGOD_DIR/pentest-patches.mjs" "$CLAWGOD_DIR/pentest-scanners.mjs" "$CLAWGOD_DIR/pentest-trimming.mjs" "$CLAWGOD_DIR/pentest-policy-text.mjs" "$CLAWGOD_DIR/pentest-pruner.mjs" "$CLAWGOD_DIR/lean-mode.cjs" "$CLAWGOD_DIR/lean-settings.json" "$CLAWGOD_DIR/.lean-disabled" "$CLAWGOD_DIR/.lean-max" "$CLAWGOD_DIR/acorn.mjs" "$CLAWGOD_DIR/acorn.LICENSE" "$CLAWGOD_DIR/patch.js" "$CLAWGOD_DIR/extract-natives.mjs" "$CLAWGOD_DIR/post-process.mjs" "$CLAWGOD_DIR/repatch.mjs" "$CLAWGOD_DIR/startup-check.cjs" "$CLAWGOD_DIR/startup-check.log" "$CLAWGOD_DIR/openai-proxy.cjs" "$CLAWGOD_DIR/feature-gates.cjs" "$CLAWGOD_DIR/runtime-helpers.cjs" "$CLAWGOD_DIR/bun-ant-shim.cjs" "$CLAWGOD_DIR/clawgod-import" "$CLAWGOD_DIR/claude.staged" "$CLAWGOD_DIR/claude.fallback" "$CLAWGOD_DIR/.source-version"
rm -rf "$CLAWGOD_DIR/bunfs" "$CLAWGOD_DIR/pathmap.json"
rm -f "$CLAWGOD_DIR/ast-helpers.mjs" "$CLAWGOD_DIR/patch-rules.mjs" "$CLAWGOD_DIR/pentest-prompts.mjs" "$CLAWGOD_DIR/prompt-runtime.cjs"
rm -f "$CLAWGOD_DIR/patch-registry.mjs" "$CLAWGOD_DIR/system-prompt.md" "$CLAWGOD_DIR/probe-tools.log" "$CLAWGOD_DIR/.clawgod-version" "$CLAWGOD_DIR/compile-runtime.mjs" "$CLAWGOD_DIR/.compiled-runtime" "$CLAWGOD_DIR/.compiled-runtime-cache.json" "$CLAWGOD_DIR"/cli.compiled-*
hash -r 2>/dev/null
info "ClawGod_Y uninstalled"
echo ""
warn "  Restart your terminal or run: hash -r"
echo ""
