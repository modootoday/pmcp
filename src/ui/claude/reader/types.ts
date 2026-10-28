import type {
  Broadcast,
  Lease,
  Pause,
  SessionRecord as StoredRecord,
} from "../../../sessions/types";

export type { Broadcast, Lease, Pause } from "../../../sessions/types";

export interface SessionRecord extends StoredRecord {
  readonly behind?: number;
}

export interface SessionSnapshot {
  readonly records: readonly SessionRecord[];
  readonly pause: Pause | null;
  readonly lease: Lease | null;
  readonly broadcast: Broadcast | null;
}

export interface StateFiles {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  list(directory: string): Promise<string[]>;
}

export interface ReadOptions {
  readonly stateDir: string;
  // [sessions] pause_file as the hook resolves it; absent means pause.json in stateDir.
  readonly pauseFile?: string;
  readonly now: number;
}

export interface UiSettings {
  readonly stateDir?: string;
  readonly sessionsPane: boolean;
  readonly statusBand: boolean;
  readonly commands: boolean;
  readonly holdForeignEdits: boolean;
  // [git.worktrees] root, absolute once parsed; absent in files projected before it was written.
  readonly worktreeRoot?: string;
}
