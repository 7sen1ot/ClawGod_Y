#!/bin/bash
set -euo pipefail
CLAWGOD_RELEASE="latest"
BUN_BIN=$(command -v bun || true)
if [ -z "$BUN_BIN" ] && [ -x "$HOME/.bun/bin/bun" ]; then BUN_BIN="$HOME/.bun/bin/bun"; fi
if [ -z "$BUN_BIN" ]; then
  curl -fsSL https://bun.sh/install | bash
  BUN_BIN="$HOME/.bun/bin/bun"
fi
release="$CLAWGOD_RELEASE"
if [ "$release" = latest ]; then
  release=$("$BUN_BIN" -e 'const r=await fetch("https://api.github.com/repos/7sen1ot/ClawGod_Y/releases/latest");if(!r.ok)throw Error(`HTTP ${r.status}`);console.log((await r.json()).tag_name)')
fi
case "$release" in v[0-9]*) ;; *) echo "Invalid release: $release" >&2; exit 1 ;; esac
base="https://github.com/7sen1ot/ClawGod_Y/releases/download/$release"
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
curl -fsSL "$base/clawgod-runtime.tar.gz" -o "$work/clawgod-runtime.tar.gz"
curl -fsSL "$base/SHA256SUMS" -o "$work/SHA256SUMS"
"$BUN_BIN" -e 'const fs=require("node:fs"),crypto=require("node:crypto");const [archive,sums]=process.argv.slice(1);const expected=fs.readFileSync(sums,"utf8").match(/^([a-f0-9]{64})  clawgod-runtime\.tar\.gz$/m)?.[1];const actual=crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");if(!expected||expected!==actual)throw Error("Runtime SHA-256 mismatch")' "$work/clawgod-runtime.tar.gz" "$work/SHA256SUMS"
tar -xzf "$work/clawgod-runtime.tar.gz" -C "$work"
"$BUN_BIN" "$work/install-runtime.mjs" "$@"
