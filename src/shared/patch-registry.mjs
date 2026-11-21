
import { upstreamPatches } from './patch-rules.mjs';
import { PENTEST_AST_PATCH_IDS, PENTEST_AST_META } from './pentest-scanners.mjs';

export const PATCHES = upstreamPatches.concat(
  PENTEST_AST_PATCH_IDS.map(id => ({ id, name: PENTEST_AST_META[id], ast: true, optional: true })),
);

// Review impact is scoped to each feature. Low affects display, medium changes
// data handling or exposes a command, high changes policy or autonomous actions.
export const FEATURES = {
  'agent-teams':    { category: 'automation', risk: 'high',
                      desc: 'Agent Teams always enabled',
                      patchIds: ['agent-teams', 'agent-teams-graph'] },
  'computer-use':   { category: 'automation', risk: 'high',
                      desc: 'Computer Use unlock',
                      patchIds: ['computer-use-sub', 'computer-use-default', 'computer-use-gate', 'computer-use-gate-semantic'] },
  'ultraplan':      { category: 'interface', risk: 'medium',
                      desc: 'Ultraplan slash command',
                      patchIds: ['ultraplan'] },
  'ultrareview':    { category: 'interface', risk: 'medium',
                      desc: 'Ultrareview slash command',
                      patchIds: ['ultrareview-gate', 'ultrareview-direct', 'ultrareview-command'] },
  'auto-mode':      { category: 'automation', risk: 'high',
                      desc: 'Auto-mode model selection on third-party APIs',
                      patchIds: ['auto-mode-helper-gate', 'auto-mode-inline-gate'] },
  'classifier-tuning': { category: 'security-policy', risk: 'high',
                      desc: 'Auto-mode classifier overrides (timeout/model/retries env vars)',
                      patchIds: ['classifier-timeout', 'classifier-model', 'classifier-retries'] },
  'geo-neutralize': { category: 'privacy', risk: 'medium',
                      desc: 'Neutralize geo/proxy steganography in system prompt',
                      patchIds: ['geo-stego-date', 'geo-detect-probe', 'geo-apostrophe-stego'] },
  'wiggly-dove':    { category: 'privacy', risk: 'medium',
                      desc: 'Block automatic Git/environment collection in x-claude-code-wiggly-dove',
                      patchIds: ['wiggly-dove'] },
  'cyber-risk':     { category: 'safety-prompt', risk: 'high',
                      desc: 'Remove CYBER_RISK_INSTRUCTION from system prompt',
                      patchIds: ['remove-cyber-risk'] },
  'url-restriction':{ category: 'safety-prompt', risk: 'high',
                      desc: 'Remove URL generation restriction from system prompt',
                      patchIds: ['remove-url-restriction'] },
  'cautious-actions':{ category: 'safety-prompt', risk: 'high',
                      desc: 'Remove "Executing actions with care" section from system prompt',
                      patchIds: ['remove-cautious-actions'] },
  'not-logged-in':  { category: 'interface', risk: 'low',
                      desc: 'Remove "Not logged in" notice',
                      patchIds: ['remove-not-logged-in'] },
  'message-filter': { category: 'security-policy', risk: 'high',
                      desc: 'Bypass non-ant message/attachment filters',
                      patchIds: ['attachment-filter-bypass', 'message-filter-legacy', 'message-filter-s8'] },
  'auto-mode-rules': { category: 'security-policy', risk: 'high',
                      desc: 'Skip the external auto-mode BLOCK rules pack',
                      patchIds: ['auto-mode-rules-off'] },
  'script-caps':   { category: 'security-policy', risk: 'high',
                      desc: 'Disable the script call limit',
                      patchIds: ['script-caps-off'] },
  'remote-settings': { category: 'security-policy', risk: 'high',
                      desc: 'Ignore enterprise-managed remote settings',
                      patchIds: ['remote-settings-off'] },
};

export function featuresMeta() {
  const meta = {};
  for (const [fid, def] of Object.entries(FEATURES)) {
    for (const pid of def.patchIds) {
      (meta[pid] ??= []).push(fid);
    }
  }
  return meta;
}
