import type { SessionSnapshot, UiSettings } from "./reader/index";

export const PANE_ID = "pmcp-sessions";
export const POLL_MS = 3000;
export const LEASE_STUCK_MS = 10 * 60 * 1000;
export const EDITS = ["Edit", "Write", "NotebookEdit"] as const;

// contract.d.ts declares pmcp/kept for the host; each reader declares its own atom for the scan.
export type Kept = { snapshot: SessionSnapshot; isOpen: boolean; now: number };

const EMPTY: SessionSnapshot = {
  records: [],
  pause: null,
  lease: null,
  broadcast: null,
};

export const state = {
  self: "",
  root: "",

  stateDir: "",
  pauseFile: "",
  settings: null as UiSettings | null,
  isOpen: false,
  signature: "",
  now: 0,
  snapshot: EMPTY,
};
