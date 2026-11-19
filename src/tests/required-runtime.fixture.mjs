// Prepatched mandatory hooks for fixtures that exercise other patch rules.
export const requiredRuntime = `
globalThis.fixtureRuntime = {
  projects: () => globalThis.__clawgodHelpers.sessionPath(/*clawgod:session-project-paths*/paths.join(root, 'projects')),
  history: () => globalThis.__clawgodHelpers.sessionPath(/*clawgod:session-history-paths*/paths.join(root, 'history.jsonl')),
  instructions: () => globalThis.__clawgodHelpers.instructionFileFilter(/*clawgod:instruction-files-off*/() => false),
};
`;
