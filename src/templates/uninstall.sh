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
UNINSTALL_FILES=(
{{CLAWGOD:uninstall-files}}
)
for file in "${UNINSTALL_FILES[@]}"; do
  rm -f "$CLAWGOD_DIR/$file"
done
UNINSTALL_DIRS=(
{{CLAWGOD:uninstall-dirs}}
)
for dir in "${UNINSTALL_DIRS[@]}"; do
  rm -rf "$CLAWGOD_DIR/$dir"
done
rm -f "$CLAWGOD_DIR"/cli.compiled-*
hash -r 2>/dev/null
info "ClawGod_Y uninstalled"
echo ""
warn "  Restart your terminal or run: hash -r"
echo ""
