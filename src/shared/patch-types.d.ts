// Matchers narrow syntax forms before accessing their form-specific fields.
// Edits, scan results and source graphs have fixed shared contracts.
export interface PatchNode {
  type: string;
  start: number;
  end: number;
  [field: string]: any;
}
export interface PatchEdit { start: number; end: number; replacement: string; strategy?: string }
export interface PatchScan { matches: PatchEdit[]; protected: [number, number][]; present: boolean; patched: boolean; skipped?: number }
export type SourceFiles = Record<string, string>;
