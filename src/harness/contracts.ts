export interface DockerResource {
  kind: "docker";
  id: string;
  owner: string;
  nonce: string;
  role: "main" | "worker";
  image: string;
  configurationDigest: string;
  memoryMb: number;
  cpuQuota: number;
  managed?: true;
  privateProfile?: string;
}

// A session lives in the group's pmcp-pty daemon: its id there, the daemon instance that holds
// it (a restarted daemon reuses ids, never instances) and the pid of the process it runs.
export interface SessionRecord {
  id: string;
  owner: string;
  runtime: string;
  socket: string;
  ptySession: string;
  ptyInstance: string;
  pid: number;
  unit: string;
  memoryMb: number;
  cwd: string;
  createdAt: string;
  stoppedAt?: string;
  resource?: DockerResource;
}

export interface SessionObservation extends SessionRecord {
  alive: boolean;
  width: number;
  height: number;
}

export interface SessionReference {
  id: string;
  role: "main" | "worker";
  stopped: boolean;
}

export interface DockerPolicy {
  schemaVersion: 1;
  image: string;
  network: "none";
  workspaceAccess: "read-only" | "read-write";
  commands: Record<string, string[]>;
  egress?: { hosts: string[]; bridgeExecutable?: string };
  privateProfiles?: Record<string, PrivateProfileGrant>;
}

export interface PrivateProfileGrant {
  runtime: string;
  directory: string;
  lockExecutable: string;
  identity?: string;
}

export interface Group {
  schemaVersion: 1;
  owner: string;
  id: string;
  generation: string;
  projectRoot: string;
  allowedRuntimes: string[];
  profile: "native" | "docker";
  dockerPolicy?: DockerPolicy;
  state: "ready" | "paused" | "stopped";
  memoryMb: number;
  maxActive: number;
  sessions: SessionReference[];
  // Environment names each session start passes from its own environment; never a value.
  env?: string[];
}

export interface Lease {
  token: string;
  sessionId: string;
  generation: string;
  controller: string;
  mode: "cli" | "native";
  expiresAt: string;
}

export interface Delivery {
  controller?: string;
  requestId: string;
  sessionId: string;
  generation: string;
  digest: string;
  operation: "write" | "submit";
  state: "intent" | "input_written" | "delivery_uncertain";
}

export interface State {
  group: Group;
  leases: Lease[];
  deliveries: Delivery[];
}

export interface Operation {
  family: string;
  action: string;
  groupFile?: string;
  generation?: string;
  input?: Record<string, unknown>;
  sessionId?: string;
  leaseFile?: string;
  controller?: string;
  mode?: string;
  requestId?: string;
  text?: string;
  includeStarts?: boolean;
}

export type Receipt = Record<string, unknown>;
