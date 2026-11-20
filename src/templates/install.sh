#!/bin/bash
set -e


CLAWGOD_DIR="$HOME/.clawgod"
BIN_DIR="$HOME/.local/bin"
VERSION="2.1.322"
CLAWGOD_SELF_VERSION="0.0.0-dev"
INSTALL_SOURCE_KEY="{{CLAWGOD:installation-key}}"

if [[ $# -gt 1 || ( $# -eq 1 && ! "$1" =~ ^(latest|stable|[0-9]+\.[0-9]+\.[0-9]+)$ ) ]]; then
  printf 'Invalid installer arguments: %s\nUsage: bash install.sh [latest|stable|<version>]\n' "$*" >&2
  exit 2
fi
if [ $# -eq 1 ]; then VERSION="$1"; fi

GREEN='\033[0;32m'
RED='\033[0;31m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "  ${GREEN}✓${NC} $1"; }
warn()  { echo -e "  ${RED}✗${NC} $1"; }
err()   { echo -e "  ${RED}✗${NC} $1" >&2; }
dim()   { echo -e "  ${DIM}$1${NC}"; }

echo ""
echo -e "${BOLD}  ClawGod_Y Installer${NC}"
echo ""

if command -v bun &>/dev/null; then
  BUN_BIN=$(command -v bun)
elif [ -x "$HOME/.bun/bin/bun" ]; then
  BUN_BIN="$HOME/.bun/bin/bun"
else
  dim "Installing Bun (sole runtime: patcher and CLI) ..."
  curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1 || true
  BUN_BIN="$HOME/.bun/bin/bun"
  if [ ! -x "$BUN_BIN" ]; then
    warn "Bun installation failed. Install manually: https://bun.sh/install"
    exit 1
  fi
fi
MIN_BUN_VERSION="1.3.14"
BUN_VERSION_RAW=$("$BUN_BIN" --version 2>/dev/null) || BUN_VERSION_RAW=
info "Bun: $BUN_VERSION_RAW"
BUN_VERSION_NUM=${BUN_VERSION_RAW%%-*}
if [ -z "$BUN_VERSION_NUM" ] \
   || [ "$(printf '%s\n%s\n' "$BUN_VERSION_NUM" "$MIN_BUN_VERSION" | sort -V | head -1)" != "$MIN_BUN_VERSION" ]; then
  warn "Bun $MIN_BUN_VERSION or later is required (found ${BUN_VERSION_RAW:-unknown}). Use bun upgrade or update Bun with your package manager."
  exit 1
fi


if ! command -v rg &>/dev/null; then
  warn "ripgrep (rg) is required but not found in PATH."
  warn "  ClawGod_Y's Grep tool will not function without it."
  warn ""
  case "$(uname -s)" in
    Darwin) warn "  Install: brew install ripgrep" ;;
    Linux)  warn "  Install: apt install ripgrep   |   dnf install ripgrep   |   pacman -S ripgrep" ;;
    *)      warn "  Install: https://github.com/BurntSushi/ripgrep#installation" ;;
  esac
  warn ""
  warn "  Re-run this script after installing rg."
  exit 1
fi
info "ripgrep: $(rg --version | head -1)"

mkdir -p "$CLAWGOD_DIR" "$BIN_DIR"

NATIVE_BIN=""


case "$(uname -s)" in
  Darwin) os="darwin" ;;
  Linux)  os="linux" ;;
  *)      os="" ;;
esac
case "$(uname -m)" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64)  arch="x64" ;;
  *)             arch="" ;;
esac
if [ "$os" = "linux" ] && (ldd /bin/ls 2>/dev/null | grep -q musl); then
  PLATFORM="${os}-${arch}-musl"
else
  PLATFORM="${os}-${arch}"
fi

if [ -z "$os" ] || [ -z "$arch" ]; then
  warn "Unsupported platform: $(uname -s) $(uname -m)"
  exit 1
fi
NPM_PKG="@anthropic-ai/claude-code-${PLATFORM}"
dim "Fetching $NPM_PKG@$VERSION from npm registry ..."
NATIVE_BIN_TMPDIR=$(mktemp -d)
cat > "$NATIVE_BIN_TMPDIR/fetch.mjs" << 'FETCH_EOF'
{{CLAWGOD:npm-fetch.mjs}}
FETCH_EOF
if "$BUN_BIN" "$NATIVE_BIN_TMPDIR/fetch.mjs" "$NPM_PKG@$VERSION" "$NATIVE_BIN_TMPDIR"; then
  if [ -f "$NATIVE_BIN_TMPDIR/package/claude" ]; then
    sz=$(stat -f%z "$NATIVE_BIN_TMPDIR/package/claude" 2>/dev/null || stat -c%s "$NATIVE_BIN_TMPDIR/package/claude" 2>/dev/null || echo 0)
    if [ "$sz" -gt 10000000 ]; then
      NATIVE_BIN="$NATIVE_BIN_TMPDIR/package/claude"
      NATIVE_BIN_LABEL=$("$BUN_BIN" -e "console.log(require(process.argv[1]).version)" "$NATIVE_BIN_TMPDIR/package/package.json" 2>/dev/null || echo "npm-latest")
    fi
  fi
fi
if [ -z "$NATIVE_BIN" ]; then
  rm -rf "$NATIVE_BIN_TMPDIR"
  warn "Failed to download $NPM_PKG@$VERSION from npm."
  warn "  Install the upstream runtime binary manually:"
  warn "    curl -fsSL https://claude.ai/install.sh | bash"
  exit 1
fi
info "Downloaded $NPM_PKG@$NATIVE_BIN_LABEL"

REUSE_PROCESSED=0
if grep -Fq "$INSTALL_SOURCE_KEY" "$CLAWGOD_DIR/.compiled-runtime-cache.json" 2>/dev/null; then
  if reuse=$("$BUN_BIN" "$CLAWGOD_DIR/compile-runtime.mjs" --check-installation "$INSTALL_SOURCE_KEY" "$NATIVE_BIN_LABEL") &&
     [ "$reuse" = "REUSE=$NATIVE_BIN_LABEL" ]; then
    REUSE_PROCESSED=1
    info "Reusing unchanged processed modules ($NATIVE_BIN_LABEL)"
  fi
fi

PREV_BACKUP_DIR=""
ROLLBACK_FILES=(
{{CLAWGOD:rollback-files}}
)
if [ "$REUSE_PROCESSED" -eq 1 ]; then
  REUSED_ROLLBACK_FILES=()
  for f in "${ROLLBACK_FILES[@]}"; do
    case "$f" in
      bunfs|vendor|pathmap.json|source-backup.json|cli.original.cjs|cli.original.cjs.bak) continue ;;
    esac
    REUSED_ROLLBACK_FILES+=("$f")
  done
  ROLLBACK_FILES=("${REUSED_ROLLBACK_FILES[@]}")
fi
if [ -f "$CLAWGOD_DIR/cli.original.cjs" ] && [ -f "$CLAWGOD_DIR/.source-version" ]; then
  PREV_BACKUP_DIR=$(mktemp -d "${CLAWGOD_DIR}-rollback-XXXXXX")
  MOVED_ROLLBACK_FILES=()
  for f in "${ROLLBACK_FILES[@]}"; do
    if [ -e "$CLAWGOD_DIR/$f" ]; then
      case "$f" in
        bunfs|vendor|source-backup.json)
          if mv "$CLAWGOD_DIR/$f" "$PREV_BACKUP_DIR/$f" 2>/dev/null; then
            MOVED_ROLLBACK_FILES+=("$f")
            continue
          fi
          ;;
      esac
      cp -a "$CLAWGOD_DIR/$f" "$PREV_BACKUP_DIR/" || {
        warn "Could not snapshot $f; restoring previous files."
        restore_failed=0
        for moved in "${MOVED_ROLLBACK_FILES[@]}"; do
          mv "$PREV_BACKUP_DIR/$moved" "$CLAWGOD_DIR/$moved" || restore_failed=1
        done
        if [ "$restore_failed" -eq 0 ]; then
          rm -rf "$PREV_BACKUP_DIR"
        else
          warn "Rollback failed; backup kept at $PREV_BACKUP_DIR"
        fi
        exit 1
      }
    fi
  done
fi

rollback_install() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ]; then
    rm -f "$CLAWGOD_DIR/claude.staged"
    rm -f "$CLAWGOD_DIR/uninstall.sh.tmp" "$BIN_DIR/clawgod.clawgod-$$.tmp"
    if [ -n "$PREV_BACKUP_DIR" ]; then
      dim "Rolling back to previous working installation ..."
      for f in "${ROLLBACK_FILES[@]}"; do rm -rf "$CLAWGOD_DIR/$f"; done
      for f in "${ROLLBACK_FILES[@]}"; do
        if [ -e "$PREV_BACKUP_DIR/$f" ]; then
          mv "$PREV_BACKUP_DIR/$f" "$CLAWGOD_DIR/$f" 2>/dev/null ||
            cp -a "$PREV_BACKUP_DIR/$f" "$CLAWGOD_DIR/$f" || {
            warn "Rollback failed; backup kept at $PREV_BACKUP_DIR"
            return
          }
        fi
      done
      info "Restored previous working installation ($(cat "$CLAWGOD_DIR/.source-version"))."
    fi
  fi
  [ -z "$PREV_BACKUP_DIR" ] || rm -rf "$PREV_BACKUP_DIR" || warn "Could not remove rollback snapshot at $PREV_BACKUP_DIR"
}
trap rollback_install EXIT

cat > "$CLAWGOD_DIR/extract-natives.mjs" << 'EXTRACTOR_EOF'
{{CLAWGOD:extract-natives.mjs}}
EXTRACTOR_EOF

if [ "$REUSE_PROCESSED" -eq 0 ]; then
  rm -rf "$CLAWGOD_DIR/vendor" "$CLAWGOD_DIR/bunfs" "$CLAWGOD_DIR/pathmap.json" \
    "$CLAWGOD_DIR/cli.original.js" 2>/dev/null

  dim "Extracting cli.js + modules from $NATIVE_BIN_LABEL ..."
  "$BUN_BIN" "$CLAWGOD_DIR/extract-natives.mjs" "$NATIVE_BIN" "$CLAWGOD_DIR" 2>&1 | while IFS= read -r line; do echo "  $line"; done
  if [ "${PIPESTATUS[0]}" -ne 0 ]; then
    err "Failed to extract from native binary"
    exit 1
  fi
  [ -f "$CLAWGOD_DIR/cli.original.js" ] || { err "cli.js missing after extraction"; exit 1; }


  dim "Rewriting bunfs paths and IIFE invocation ..."
fi
cat > "$CLAWGOD_DIR/post-process.mjs" << 'POSTPROC_EOF'
{{CLAWGOD:post-process.mjs}}
POSTPROC_EOF
cat > "$CLAWGOD_DIR/openai-proxy.cjs" << 'PROXY_EOF'
{{CLAWGOD:openai-proxy.cjs}}
PROXY_EOF
info "OpenAI-compatible proxy created (openai-proxy.cjs)"

cat > "$CLAWGOD_DIR/feature-gates.cjs" << 'GATES_EOF'
{{CLAWGOD:feature-gates.cjs}}
GATES_EOF
info "Patch feature gates created (feature-gates.cjs)"

cat > "$CLAWGOD_DIR/cli.cjs" << 'WRAPPER_EOF'
{{CLAWGOD:cli.cjs}}
WRAPPER_EOF
chmod +x "$CLAWGOD_DIR/cli.cjs"
echo "$CLAWGOD_SELF_VERSION" > "$CLAWGOD_DIR/.clawgod-version"
info "Wrapper created (cli.cjs)"

cat > "$CLAWGOD_DIR/startup-check.cjs" << 'STARTUP_EOF'
{{CLAWGOD:startup-check.cjs}}
STARTUP_EOF

cat > "$CLAWGOD_DIR/compile-runtime.mjs" << 'COMPILE_EOF'
{{CLAWGOD:compile-runtime.mjs}}
COMPILE_EOF

cat > "$CLAWGOD_DIR/runtime-helpers.cjs" << 'CFG_EOF'
{{CLAWGOD:runtime-helpers.cjs}}
CFG_EOF
cat > "$CLAWGOD_DIR/prompt-runtime.cjs" << 'PROMPT_RUNTIME_EOF'
{{CLAWGOD:prompt-runtime.cjs}}
PROMPT_RUNTIME_EOF
info "Classifier runtime helpers created (runtime-helpers.cjs)"

cat > "$CLAWGOD_DIR/bun-ant-shim.cjs" << 'BUNANT_EOF'
{{CLAWGOD:bun-ant-shim.cjs}}
BUNANT_EOF
info "Bun.ant runtime shim created (bun-ant-shim.cjs)"

cat > "$CLAWGOD_DIR/acorn.mjs" << 'ACORN_EOF'
{{CLAWGOD:acorn.mjs}}
ACORN_EOF
cat > "$CLAWGOD_DIR/acorn.LICENSE" << 'ACORN_LICENSE_EOF'
{{CLAWGOD:acorn.LICENSE}}
ACORN_LICENSE_EOF

cat > "$CLAWGOD_DIR/ast-helpers.mjs" << 'AST_HELPERS_EOF'
{{CLAWGOD:ast-helpers.mjs}}
AST_HELPERS_EOF

if [ "$REUSE_PROCESSED" -eq 0 ]; then
  "$BUN_BIN" "$CLAWGOD_DIR/post-process.mjs" 2>&1 | while IFS= read -r line; do echo "  $line"; done
  if [ "${PIPESTATUS[0]}" -ne 0 ]; then err "Post-process failed"; exit 1; fi
  [ -f "$CLAWGOD_DIR/cli.original.cjs" ] || { err "Post-process failed"; exit 1; }
fi

echo "$NATIVE_BIN_LABEL" > "$CLAWGOD_DIR/.source-version"

if [ -f "$NATIVE_BIN" ]; then
  mv -f "$NATIVE_BIN" "$CLAWGOD_DIR/claude.staged"
fi

if [ -n "$NATIVE_BIN_TMPDIR" ]; then
  rm -rf "$NATIVE_BIN_TMPDIR"
fi

info "cli.original.cjs ready ($NATIVE_BIN_LABEL)"

cat > "$CLAWGOD_DIR/ast-patches.mjs" << 'AST_PATCHES_EOF'
{{CLAWGOD:ast-patches.mjs}}
AST_PATCHES_EOF
cat > "$CLAWGOD_DIR/pentest-patches.mjs" << 'PENTEST_PATCHES_EOF'
{{CLAWGOD:pentest-patches.mjs}}
PENTEST_PATCHES_EOF

cat > "$CLAWGOD_DIR/pentest-scanners.mjs" << 'PENTEST_SCANNERS_EOF'
{{CLAWGOD:pentest-scanners.mjs}}
PENTEST_SCANNERS_EOF
cat > "$CLAWGOD_DIR/pentest-prompts.mjs" << 'PENTEST_PROMPTS_EOF'
{{CLAWGOD:pentest-prompts.mjs}}
PENTEST_PROMPTS_EOF
cat > "$CLAWGOD_DIR/pentest-trimming.mjs" << 'PENTEST_TRIMMING_EOF'
{{CLAWGOD:pentest-trimming.mjs}}
PENTEST_TRIMMING_EOF
cat > "$CLAWGOD_DIR/pentest-policy-text.mjs" << 'PENTEST_POLICY_TEXT_EOF'
{{CLAWGOD:pentest-policy-text.mjs}}
PENTEST_POLICY_TEXT_EOF
cat > "$CLAWGOD_DIR/pentest-pruner.mjs" << 'PENTEST_PRUNER_EOF'
{{CLAWGOD:pentest-pruner.mjs}}
PENTEST_PRUNER_EOF

cat > "$CLAWGOD_DIR/lean-mode.cjs" << 'LEAN_MODE_EOF'
{{CLAWGOD:lean-mode.cjs}}
LEAN_MODE_EOF

cat > "$CLAWGOD_DIR/system-prompt.md" << 'SYSTEM_PROMPT_EOF'
{{CLAWGOD:system-prompt.md}}
SYSTEM_PROMPT_EOF

cat > "$CLAWGOD_DIR/patch-rules.mjs" << 'PATCH_RULES_EOF'
{{CLAWGOD:patch-rules.mjs}}
PATCH_RULES_EOF
cat > "$CLAWGOD_DIR/patch.mjs" << 'PATCHER_EOF'
{{CLAWGOD:patch.mjs}}

PATCHER_EOF
cat > "$CLAWGOD_DIR/patch-registry.mjs" << 'PATCH_REGISTRY_EOF'
{{CLAWGOD:patch-registry.mjs}}

PATCH_REGISTRY_EOF
info "Patcher created (patch.mjs)"


if [ "$REUSE_PROCESSED" -eq 0 ]; then
  dim "Applying patches ..."
  "$BUN_BIN" "$CLAWGOD_DIR/patch.mjs" --capture-and-apply 2>&1 | while IFS= read -r line; do echo "  $line"; done
  patch_status=${PIPESTATUS[0]}
  if [ "$patch_status" -ne 0 ]; then
    warn "Patching failed (bun exit $patch_status). Installation aborted."
    if [ -z "$PREV_BACKUP_DIR" ]; then
      warn "No previous working installation found to roll back."
    fi
    warn ""
    warn "The selected upstream runtime build (${NATIVE_BIN_LABEL:-unknown}) is not supported by this ClawGod_Y release."
    warn "Optional unmatched patches are already skipped; required prompt injection and source errors cannot be skipped."
    warn "Rerun the installer with a compatible upstream runtime version."
    exit "$patch_status"
  fi
fi

dim "Compiling startup runtime ..."
"$BUN_BIN" "$CLAWGOD_DIR/compile-runtime.mjs"

if grep -rqs "Bun\.ant\.CellSegmenter" "$CLAWGOD_DIR/bunfs" "$CLAWGOD_DIR/cli.original.cjs" 2>/dev/null; then
  info "Renderer runtime: Bun.ant.CellSegmenter (Claude >= 2.1.271) — served by bun-ant-shim.cjs"
else
  info "Renderer runtime: stock Bun APIs (shim present but unused)"
fi

if [ ! -f "$CLAWGOD_DIR/features.json" ]; then
  cat > "$CLAWGOD_DIR/features.json" << 'FEATURES_EOF'
{{CLAWGOD:features.json}}
FEATURES_EOF
  info "Default features.json created"
fi

if [ ! -f "$CLAWGOD_DIR/patches.json" ]; then
  printf '{}\n' > "$CLAWGOD_DIR/patches.json"
  info "Default patches.json created (all features on)"
fi

if [ ! -f "$CLAWGOD_DIR/provider.json" ]; then
  cat > "$CLAWGOD_DIR/provider.json" << 'PROVIDER_EOF'
{
  "protocol": "anthropic",
  "apiKey": "",
  "baseURL": "https://api.anthropic.com",
  "model": "",
  "smallModel": "",
  "effort": "",
  "timeoutMs": 3000000
}
PROVIDER_EOF
fi


rm -f "$CLAWGOD_DIR/.lean-disabled" "$CLAWGOD_DIR/.lean-max"

"$BUN_BIN" -e '
const {leanApply}=require(process.argv[1]);
try{leanApply(process.argv[2],undefined,process.argv[3])}catch{}
' "$CLAWGOD_DIR/lean-mode.cjs" "$CLAWGOD_DIR/lean-settings.json" "$CLAWGOD_DIR/patches.json" 2>/dev/null || true
info "Lean settings applied (strictest, clawgod-scoped): ~/.clawgod/lean-settings.json"

dim "Verifying Bun can load patched cli.original.cjs (bounded startup check) ..."
sanity_rc=0
sanity_out=$("$BUN_BIN" "$CLAWGOD_DIR/startup-check.cjs" "$BUN_BIN" "$CLAWGOD_DIR/cli.cjs" 2>&1) || sanity_rc=$?
if echo "$sanity_out" | grep -q "Expected CommonJS module to have a function wrapper"; then
  warn "Bun $BUN_VERSION_RAW could not load this CLI. Use bun upgrade or update Bun with your package manager."
  exit 1
fi
if [ "$sanity_rc" -ne 0 ]; then
  warn "Patched Claude failed its startup check (exit $sanity_rc):"
  printf '%s\n' "$sanity_out"
  exit "$sanity_rc"
fi
info "Bun loads cli.original.cjs"
dim "Verifying tool/command tables load (bounded probe) ..."
probe_rc=0
probe_out=$("$BUN_BIN" "$CLAWGOD_DIR/startup-check.cjs" "$BUN_BIN" "$CLAWGOD_DIR/cli.cjs" --probe-tools 2>&1) || probe_rc=$?
if [ "$probe_rc" -ne 0 ]; then
  warn "Patched Claude failed its tool-table probe (exit $probe_rc):"
  printf '%s\n' "$probe_out"
  exit "$probe_rc"
fi
info "Tool and command tables load cleanly"


IMPORT_BIN="$CLAWGOD_DIR/clawgod-import"
if [ ! -x "$IMPORT_BIN" ]; then
  IMPORT_URL="https://github.com/7sen1ot/ClawGod_Y/releases/latest/download/clawgod-import-$os-$arch"
  if curl -fsSL -o "$IMPORT_BIN" "$IMPORT_URL" 2>/dev/null; then
    chmod +x "$IMPORT_BIN"
    info "Provider import tool installed (clawgod-import)"
  else
    dim "Provider import tool not yet available (build pending)"
  fi
fi

LAUNCHER_CONTENT="#!/bin/bash

CLAWGOD_CLI=\"$CLAWGOD_DIR/cli.cjs\"
CLAWGOD_IMPORT=\"$CLAWGOD_DIR/clawgod-import\"
BUN_BIN=\"$BUN_BIN\"

if [ \"\$1\" = \"import\" ]; then
  shift
  if [ -x \"\$CLAWGOD_IMPORT\" ]; then
    exec \"\$CLAWGOD_IMPORT\" \"\$@\"
  else
    echo \"clawgod: import tool not installed. Reinstall clawgod to get it.\" >&2
    exit 127
  fi
fi
if [ ! -f \"\$CLAWGOD_CLI\" ]; then
  echo \"clawgod: installation at $CLAWGOD_DIR is missing (cli.cjs not found)\" >&2
  echo \"clawgod: reinstall via  curl -fsSL https://github.com/7sen1ot/ClawGod_Y/releases/latest/download/install.sh | bash\" >&2
  echo \"clawgod: or remove this launcher:  rm \\\"\$0\\\"\" >&2
  exit 127
fi
if [ ! -x \"\$BUN_BIN\" ]; then
  if command -v bun >/dev/null 2>&1; then BUN_BIN=\"\$(command -v bun)\"; fi
fi
if [ ! -x \"\$BUN_BIN\" ]; then
  echo \"clawgod: bun runtime not found at \$BUN_BIN\" >&2
  echo \"clawgod: install bun  curl -fsSL https://bun.sh/install | bash\" >&2
  exit 127
fi
export CLAUDE_CODE_EXECPATH=\"$CLAWGOD_DIR/claude.fallback\"
export HERDR_AGENT=\"\${HERDR_AGENT:-claude}\"
export IS_SANDBOX=\"\${IS_SANDBOX:-1}\"
if [ \"\$1\" != \"--uninstall\" ] && [ -f \"$CLAWGOD_DIR/.compiled-runtime\" ]; then
  COMPILED_NAME=\"\$(cat \"$CLAWGOD_DIR/.compiled-runtime\")\"
  if [ -x \"$CLAWGOD_DIR/\$COMPILED_NAME\" ]; then exec \"$CLAWGOD_DIR/\$COMPILED_NAME\" \"\$@\"; fi
fi
exec \"\$BUN_BIN\" \"\$CLAWGOD_CLI\" \"\$@\""

write_launcher() {
  local target="$1"
  local dir
  dir=$(dirname "$target")
  mkdir -p "$dir"
  local temporary="$target.clawgod-$$.tmp"
  printf '%s\n' "$LAUNCHER_CONTENT" > "$temporary"
  chmod +x "$temporary"
  [ ! -d "$target" ] || { err "Launcher target is a directory: $target"; return 1; }
  mv -f "$temporary" "$target"
}

if [ -f "$CLAWGOD_DIR/claude.staged" ]; then
  rm -f "$CLAWGOD_DIR/claude.fallback"
  mv -f "$CLAWGOD_DIR/claude.staged" "$CLAWGOD_DIR/claude.fallback"
fi
chmod +x "$CLAWGOD_DIR/claude.fallback"

cat > "$CLAWGOD_DIR/uninstall.sh.tmp" <<'CLAWGOD_UNINSTALL_EOF'
{{CLAWGOD:standalone-uninstaller}}
CLAWGOD_UNINSTALL_EOF
[ -s "$CLAWGOD_DIR/uninstall.sh.tmp" ] || { err "Uninstaller is missing or empty"; exit 1; }
chmod +x "$CLAWGOD_DIR/uninstall.sh.tmp"
mv -f "$CLAWGOD_DIR/uninstall.sh.tmp" "$CLAWGOD_DIR/uninstall.sh"


if ! echo "$PATH" | grep -q "$BIN_DIR"; then

  case "$(basename "$SHELL")" in
    zsh)  SHELL_RC="$HOME/.zshrc" ;;
    bash) SHELL_RC="$HOME/.bashrc" ;;
    fish) SHELL_RC="$HOME/.config/fish/config.fish" ;;
    *)    SHELL_RC="$HOME/.profile" ;;
  esac
  echo ""
  warn "$BIN_DIR is not in PATH. Run:"
  dim "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> $SHELL_RC && source $SHELL_RC"
fi

write_launcher "$BIN_DIR/clawgod"
rollback_install
info "Command 'clawgod' → patched ($BIN_DIR/clawgod); 'claude' untouched"
COMPILED_NAME=$(cat "$CLAWGOD_DIR/.compiled-runtime" 2>/dev/null || true)
for compiled in "$CLAWGOD_DIR"/cli.compiled-*; do
  [ "$compiled" = "$CLAWGOD_DIR/$COMPILED_NAME" ] || rm -f "$compiled" || true
done
rm -f "$BIN_DIR/claude.orig" "$CLAWGOD_DIR/install.sh" || true

hash -r 2>/dev/null

"$BUN_BIN" "$CLAWGOD_DIR/compile-runtime.mjs" --record-installation "$INSTALL_SOURCE_KEY" "$NATIVE_BIN_LABEL" || true

echo ""
echo -e "  ${BOLD}${GREEN}ClawGod_Y installed!${NC}"
echo ""
dim "  clawgod           — Start ClawGod_Y"
dim "  claude            — Original upstream CLI (untouched)"
echo ""
dim "  ClawGod_Y runtime version: $NATIVE_BIN_LABEL"
dim "  clawgod --version   — Query the ClawGod_Y runtime version"
dim "  clawgod --uninstall — Uninstall ClawGod_Y"
dim "  Vanilla 'claude update' keeps working and updates only the original."
echo ""
dim "  If 'clawgod' is not found, restart your terminal or run: hash -r"
echo ""
dim "  Config: ~/.clawgod/provider.json"
dim "  Flags:  ~/.clawgod/features.json"
echo ""
