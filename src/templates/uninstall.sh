#!/bin/bash
set -euo pipefail
BUN_BIN=$(command -v bun || true)
if [ -z "$BUN_BIN" ]; then BUN_BIN="$HOME/.bun/bin/bun"; fi
if [ -f "$HOME/.clawgod/install-runtime.mjs" ]; then
  exec "$BUN_BIN" "$HOME/.clawgod/install-runtime.mjs" --uninstall
fi
curl -fsSL https://github.com/7sen1ot/ClawGod_Y/releases/latest/download/install.sh | bash -s -- --uninstall
