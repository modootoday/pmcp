export type Argv = readonly string[];

export interface Reporter {
  info(line: string): void;
  warn(line: string): void;
}

export interface WorktreesConfig {
  readonly root: string;
  readonly branchPrefix: string;
  readonly aliasPattern: string;
  readonly bootstrap?: Argv;
  readonly linkFromMain: readonly string[];
}

export interface WorktreeSyncConfig {
  readonly onSessionStart: string;
  readonly installAfterMove: "background" | "foreground" | "off";
  readonly betweenPrompts: string;
  readonly noticePaths: readonly string[];
}

export interface GateConfig {
  readonly command?: Argv;
  readonly tree?: string;
  readonly lockWaitSeconds: number;
  // Set to 1 for the gate command and its children; a deliver started with it set does not
  // take the lock again, so another tool sharing the lock can nest pmcp or be nested.
  readonly lockEnv?: string;
}

export interface DeliverConfig {
  readonly attempts: number;
  readonly refuseDirectPush: boolean;
  readonly duringPause: "refuse" | "allow";
  readonly leaseWaitSeconds: number;
  readonly notify?: Argv;
}

export interface MainlineSyncConfig {
  readonly install?: Argv;
  readonly installWhenChanged: readonly string[];
  readonly keepIdenticalFiles: boolean;
  readonly refuseWithUnlanded: boolean;
}

export interface SubmodulesConfig {
  readonly follow: "clean_pins" | "off";
}

export interface LeaseSpec {
  readonly name: string;
  readonly paths: readonly string[];
}

export interface GitConfig {
  readonly enabled: "auto" | boolean;
  readonly remote?: string;
  readonly mainline?: string;
  readonly worktrees?: WorktreesConfig;
  readonly worktreeSync?: WorktreeSyncConfig;
  readonly gate?: GateConfig;
  readonly deliver?: DeliverConfig;
  readonly sync?: MainlineSyncConfig;
  readonly submodules?: SubmodulesConfig;
  readonly stateDir?: string;
  readonly leases: readonly LeaseSpec[];
}

export interface GitContext {
  readonly root: string;
  readonly gitDir: string;
  readonly commonDir: string;
  readonly mainRoot: string;
  readonly linked: boolean;
  readonly remote: string;
  readonly mainline: string;
  readonly upstream: string;
  readonly projectId: string;
}
