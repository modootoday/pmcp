import type {
  Group,
  SessionObservation,
  Delivery,
} from "../harness/contracts.js";
import type { TerminalLayout } from "../harness/terminal/layout.js";

export type ControlPhase =
  | "read-only"
  | "acquiring"
  | "connecting"
  | "controlled"
  | "releasing"
  | "uncertain";
export type PanelRole =
  "dock" | "coordination" | "management" | "history" | "mailbox";
export type Action =
  | "inspect"
  | "open"
  | "main"
  | "observe"
  | "control"
  | "release"
  | "history"
  | "mailbox"
  | "resize"
  | "stop"
  | "detach"
  | "disconnect"
  | "close"
  | "dismiss"
  | "management"
  | "check";

export interface ViewFailure {
  action: string;
  code: string;
  hint: string;
  at: string;
  inputReplayed: false;
}

export interface View {
  schemaVersion: 1;
  owner: string;
  directory: string;
  groupFile: string;
  generation: string;
  groupOwner: string;
  mainId: string;
  target: string;
  state: "open" | "closed";
  phase: ControlPhase;
  plan: TerminalLayout;
  node: string;
  worker: string;
  session: string;
  window: string;
  mainPane: string;
  serverIdentity: string;
  workerWindow?: string;
  workerPane?: string;
  observerRole?: "native" | "history" | "mailbox";
  dockPane?: string;
  coordinationPane?: string;
  managementWindow?: string;
  leaseFile?: string;
  failure?: ViewFailure;
  lastAction?: {
    action: string;
    status: "running" | "completed" | "failed";
    at: string;
  };
  mailbox?: { config: string; actorFile: string };
}

export interface Snapshot {
  group: Group;
  sessions: (SessionObservation & { role: "main" | "worker" })[];
  deliveries: Delivery[];
  control: {
    sessionId: string;
    controller: string;
    mode: string;
    expiresAt: string;
  }[];
}

export interface ViewInput {
  columns?: number;
  rows?: number;
  index?: number;
  confirmSession?: string;
}

export interface CreateInput {
  groupFile: string;
  columns: number;
  rows: number;
  mailbox?: View["mailbox"];
}
