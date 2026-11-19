# Installer and uninstaller build sources

The release workflow builds `install.sh`, `install.ps1`, `uninstall.sh`, and
`uninstall.ps1` from the templates and publishes them as release assets. Git
ignores the four local outputs. Each installer embeds its matching standalone
uninstaller and writes it to `~/.clawgod/` for `clawgod --uninstall`.
To build a local copy, run

```bash
bun build.js
bun build.js --check
```

`--check` renders all templates in memory. If any local output exists, it
also checks all four files against the rendered bytes.
`.gitattributes` pins the complete build graph to LF on every platform.

The installers accept one optional version argument: `latest`, `stable`, or an
explicit version. With no argument, they use the default in the template.
Rerun the installer with the selected version to refresh an installation.

## Semantic patching

The patcher uses Acorn AST nodes for patches such as `user-type-ant`,
`bun-standalone-executable`, `ultraplan`, `geo-stego-date`, and `wiggly-dove`.
Upstream patch definitions live in `shared/patch-rules.mjs`; AST matchers and helpers
live in `shared/ast-patches.mjs` and `shared/ast-helpers.mjs`.
The patcher caches parsed candidate source, locates stable property/string names
and grammar nodes, and splices only those node ranges. Metadata order, quote style, whitespace, and supported
function forms do not determine the location. Comments and text inside strings
are not patch sites for AST matchers. Other patches use string or regex matchers.

AST edits are checked for overlap and reparsed before the regex phase. Parse
failures abort without writing runtime source. Unmatched non-required patches
are skipped by default; stale matchers emit warnings and preserve upstream
behavior at those sites. Required runtime and bundled prompt hooks must match
before patched source is written. The scanner accepts extracted CommonJS and
ESM chunks, including top-level return and import/export statements.

`shared/acorn.mjs` is the unmodified distribution from **Acorn 8.18.0**, vendored
with its MIT license in `shared/acorn.LICENSE`. Both installers embed the parser,
patch modules, and license, so patching requires no npm dependency installation.
Include the imported modules when copying the patcher, and preserve them in
installation rollback snapshots.

## Testing

From the repository root, `bun run test` builds the installers and runs the
source, installer, proxy and issue-policy suites. Platform-specific PowerShell
and terminal checks run in CI.

`bun src/tests/ast-patches.test.mjs` checks semantic locations, property
reordering, quoted/computed keys, supported function forms, neighboring code,
runtime toggles, repeated patching, dry-run/verify, clean-source restoration,
and syntax-failure safety. CI runs this suite alongside the patch integration
fixtures in `src/tests/patch.test.mjs`.

`src/tests/patch.test.mjs` tests the classifier-timeout helper in
`runtime-helpers.cjs` and runs the patcher on legacy bundles and chunk graphs.
It checks Ultraplan toggles, prompt assembly hooks, metadata preservation,
and warning/skip behavior for unsupported non-required shapes.
The suite uses local fixtures and runs under Bun.

```bash
bun src/tests/patch.test.mjs
```

The same suite checks the `wiggly-dove` privacy gate with renamed flag
bindings, legacy/chunk layouts, runtime toggles, repeated patching, and stale
matcher warnings. A bounded loopback HTTP capture verifies that automatic
Git metadata never reaches the request while the protection is enabled.
The patch covers this automatic metadata channel; prompts and tool results
keep their usual behavior. If the matcher becomes stale, this non-required
patch is skipped with a warning and the upstream behavior is retained.

`src/tests/bun-ant-shim.test.mjs` tests the `Bun.ant.CellSegmenter`
implementation in `bun-ant-shim.cjs`: escape scanning, grapheme widths, style
runs, hyperlink runs, capacity reporting, and the cell/damage packing that the
patched bundle reads back. It runs under plain Node too, because the shim
falls back to a local width table when `Bun.stringWidth` is unavailable:

```bash
bun src/tests/bun-ant-shim.test.mjs
```

`src/tests/terminal-reply.test.mjs` checks the incomplete DA1 reply timer,
normal keyboard/paste fallback, its two-second timeout, and the actual patch
composition for legacy bundles and chunk graphs:

```bash
bun src/tests/terminal-reply.test.mjs
```

While a terminal probe is pending, a lone Escape or Alt+[ may wait up to two
seconds for a reply continuation before the original parser handles it. With
no outstanding probe, the original input timing is unchanged.

`src/tests/lean.test.mjs` exercises the full launcher with isolated settings,
plus the Unix and Windows install/uninstall settings handling. It covers the
single `~/.clawgod/lean-settings.json` configuration, cleanup of legacy managed
settings, preservation of user settings, provider parity, explicit network
environment settings, and launcher `--settings` arguments:

```bash
bun src/tests/lean.test.mjs
```

`src/tests/provider.test.mjs` runs the launcher and proxy request handler with
isolated configuration and mocked HTTP transport. It checks provider authentication,
blank-token fallback, effort translation and environment precedence, including
streaming requests and custom model aliases that omit `output_config`:

```bash
bun src/tests/provider.test.mjs
```

`src/tests/openai-proxy.test.mjs` exercises request/response translation,
including inline system messages alongside the top-level system prompt,
tool selection and parallel calls, images/PDFs and unsupported content errors,
local token estimates, HTTP failures, SSE framing and fragmented UTF-8,
usage trailers, incomplete streams, cancellation, and timeouts. The provider
suite also checks protocol selection, legacy aliases, and configuration errors.

```bash
bun run test:proxy
```

The integration suite runs a real Bun proxy and loopback HTTP upstream. It
verifies a complete tool call/result round trip, streaming token accounting,
error status/retry headers, local counting without network calls, and stream
timeouts. CI runs both suites under Bun on Linux, macOS, and Windows. A change
confined to the proxy or its tests skips the installer compatibility matrix.

The proxy reuses the last upstream input-token count for an identical model,
input configuration and message prefix. For an extended conversation it
estimates only the added messages. The count endpoint marks an identical
request as `upstream` and other counts as `estimate` in the
`x-clawgod-token-count` header. Tool and output schemas contribute to estimates.
URL PDFs are forwarded as file attachments to providers that accept URLs in
`file_data`. OpenAI's Chat Completions file input accepts base64 PDF data.

In `compat-daily.yml`, `build-sources` builds the scripts and runs the source
suite under Bun. Compatibility smoke jobs run on Linux, macOS, and Windows
with the Bun version pinned in `.bun-version`. Branch pushes and pull requests
use the template's default Claude version. Scheduled, manual and release runs
also check npm's `stable` and `latest` versions. Equal versions run once.

`installer-checks.yml` covers installation, rollback, standalone uninstallation,
downloads, native extraction, compiled startup, and source fallback. Its matrix
uses the pinned Bun version on all three platforms, plus Bun 1.3.14
on Ubuntu. Scheduled, manual and release runs also exercise the proxy on each
platform using the pinned Bun version. `prompt-request.integration.test.mjs` is available for manual runs.

`src/ci/tui-smoke.py` tests an installed CLI in a POSIX PTY or Windows ConPTY.
It uses isolated configuration and a local mock API, types a prompt, and
checks the rendered screen for the reply. Install its Python dependencies
from `src/ci/tui-requirements.txt`. Windows CI runs it against the resolved Claude
version matrix with the pinned Bun version. Terminal logs, final screens and results are
uploaded as CI artifacts.

`src/tests/updater.test.mjs` checks that the launcher disables native
background updates before loading Claude, including inherited false values.
`src/tests/startup-check.test.mjs` checks the installer's bounded startup
probe, version output, errors, closed stdin, paths with spaces/non-ASCII text,
process-tree timeout cleanup, logs, and standalone version-query side effects.
Version detection uses stdout independently of stderr and the truncated log
tail, including split writes and interleaved/noisy diagnostics.
It also runs the real Bun launcher when Bun is on PATH or specified through
`CLAWGOD_TEST_BUN`. `src/windows/startup-check.test.ps1` exercises the actual
PowerShell installer check with successful, failing and hanging child processes.
The smoke jobs configure a dummy Chat provider before installation, check that
the installer preserves it, and reject version probes that start a proxy listener.

Both installers use `startup-check.cjs` (under Bun) for `--version` and
`--probe-tools` checks before finalizing launchers. It runs the selected compiled
runtime, or `cli.cjs` under Bun, with a default 30-second deadline per probe.
`CLAWGOD_STARTUP_TIMEOUT_MS` can adjust that deadline. Output is recorded in
`~/.clawgod/startup-check.log` and `~/.clawgod/probe-tools.log`; failed probes
abort installation. Printing a version without exiting is still a failure.
A standalone `--version` or `-v` loads the patched bundle and runtime helpers
without initializing the provider,
migrating settings, or starting the background release check.

`src/windows/launchers.test.ps1` runs the installer's launcher section on real
Windows files. It covers native executable isolation, repeated installs,
compiled/source launcher selection, argument passing, and legacy artifact cleanup.
Run the JavaScript scripts with Bun and the Windows scripts with PowerShell 5.1.

Each installation refreshes the private `~/.clawgod/claude.fallback` binary
(`claude.fallback.exe` on Windows) from the selected Claude version. Launchers
set `CLAUDE_CODE_EXECPATH`, and `cli.cjs` redirects `process.execPath` there for
native subprocesses. The original `claude` installation remains separate.
`launchers.test.ps1` and `src/tests/native-refresh.test.mjs` cover this isolation
on Windows and Unix, including protection against writing through a symlink.

## Layout

`source-backup.json` in the installed directory stores clean entry and graph
source after extraction/post-processing. `pathmap.json` loader metadata selects
code chunks; text and file assets are excluded. The installers use
`--capture-and-apply` to capture fresh source and patch it in one invocation.
`--capture-clean-source` captures a snapshot without patching. Both capture
modes must only run against freshly extracted, unpatched source.

Normal patching and revert use the clean snapshot when present; verify inspects
the installed source. Invalid snapshots or missing graph loader metadata stop
processing and request reinstallation. Rerun the installer for the selected
Claude version to refresh the extracted source and snapshot. Patched source is
written only after required hooks and syntax checks pass.

`bun src/tests/source-backup.test.mjs` covers repeated patching, graph and
legacy backups, version/file-set validation, revert, and failure without source
writes, plus Unix extraction/patch rollback and failure propagation. Windows
rollback is covered by `src/windows/source-recovery.test.ps1`. The source-backup
fixture compares summaries across repeated runs. The real installation jobs
check each installation log against the coverage baseline.

- `install-files.cjs` lists embedded sources and generates the rollback and
  uninstall lists for each platform. Both lists include the installed runtime
  payloads. User configuration and the cached uninstaller are retained on uninstall.
- `tests/` contains the JavaScript suites and their fixtures.
- `shared/` contains cross-platform payloads and the vendored Acorn parser.
  `cli.cjs` is the launcher bootstrap for Unix and Windows.
  `feature-gates.cjs` carries a `const CLAWGOD_FEATURES_META = {};`
  marker that `build.js` replaces with `featuresMeta()` from
  `shared/patch-registry.mjs`. Each feature there declares a category and a
  review risk level. These labels describe the feature's impact on the interface,
  data handling, autonomous execution, or upstream policy.
  `bun-ant-shim.cjs` re-implements the `Bun.ant.CellSegmenter` API that Claude
  Code 2.1.271+ renders through, since stock Bun has no `Bun.ant` namespace;
  `cli.cjs` loads it before `cli.original.cjs`.
- `windows/` contains genuinely platform-specific payloads (the PowerShell
  build applies `escapeNonAscii` per file in build.js).
- `templates/` contains the platform-specific install and uninstall templates.
  The build expands the payload and file-list placeholders. The generated
  uninstallers carry their own cleanup lists and run offline.

The main responsibilities within `shared/` are:

| Files | Responsibility |
| --- | --- |
| `patch.mjs` / `patch-rules.mjs` | Patch orchestration and clean snapshots / patch definitions |
| `ast-patches.mjs` / `ast-helpers.mjs` | Concrete AST matchers / parsing, traversal, contexts, and edits |
| `pentest-scanners.mjs` / `pentest-prompts.mjs` | Runtime scanners and shared scanner utilities / prompt scanning, rewriting, and branding |
| `runtime-helpers.cjs` / `prompt-runtime.cjs` | Runtime utilities and compatibility re-exports / prompt assembly, identity, summaries, and request handling |
| `compile-runtime.mjs` | Compiled runtime preparation and source fallback |

The main PowerShell templates and generated install/uninstall scripts are
intentionally BOM-free and ASCII-only. This keeps Windows PowerShell 5.1 file
execution and downloaded script execution independent of the active code page.
`build.js` escapes Unicode in embedded JavaScript/JSON payloads as `\uXXXX`.
