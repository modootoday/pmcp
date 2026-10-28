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
  // Which linked worktrees are desks: a glob relative to the main checkout, default <root>/*.
  readonly desks: string;
}

export interface WorktreeSyncConfig {
  readonly onSessionStart: string;
  readonly installAfterMove: "background" | "foreground" | "off";
  readonly betweenPrompts: string;
  readonly noticePaths: readonly string[];
  // "desk": a delivery run in a desk syncs that desk once delivered.
  readonly afterDeliver?: "desk" | "off";
}

export interface GateConfig {
  readonly command?: Argv;
  readonly tree?: string;
  readonly lockWaitSeconds: number;
  // Set to 1 for the gate command and its children; a deliver started with it set does not
  // take the lock again, so another tool sharing the lock can nest pmcp or be nested.
  readonly lockEnv?: string;
  // A variable that, when set, names the gate tree instead of tree (and so the lock beside it).
  readonly treeEnv?: string;
  // Where each gate's full output is kept, a directory per tip; default <state dir>/gate-logs.
  readonly logDir?: string;
  // How many tips' gate logs are kept (every run of a kept tip stays).
  readonly logKeep?: number;
  // Wait, holding the lock, until the 1-minute load average is below this before the gate.
  readonly maxLoad?: number;
  readonly loadWaitSeconds?: number;
}

export interface DeliverConfig {
  readonly attempts: number;
  readonly refuseDirectPush: boolean;
  readonly duringPause: "refuse" | "allow";
  readonly leaseWaitSeconds: number;
  readonly notify?: Argv;
  // Who gates: pmcp's [git.mainline.gate] command, or the repository's own pre-push hook.
  readonly gate: "command" | "pre-push";
  // Extra variables for the push alone, so a repository hook can recognise a delivery.
  readonly pushEnv: Readonly<Record<string, string>>;
}

export interface MainlineSyncConfig {
  readonly install?: Argv;
  readonly installWhenChanged: readonly string[];
  readonly keepIdenticalFiles: boolean;
  readonly refuseWithUnlanded: boolean;
  // Which deliveries sync the main checkout once delivered: one run in it ("from_main", also
  // when absent), any, including one from a linked worktree ("always"), or none ("off").
  readonly afterDeliver?: "from_main" | "always" | "off";
  // A stamp shared with another tool; absent, pmcp keeps its own in the state dir.
  readonly stamp?: { readonly path: string; readonly hash: "pmcp" | "plain" };
}

export interface SubmodulesConfig {
  readonly follow: "clean_pins" | "off";
  // Checkouts other sessions also work in: moved even with edits that do not conflict.
  readonly shared: readonly string[];
  // "pins": deliver pushes each submodule pin its commits set to that submodule's origin first.
  readonly push: "pins" | "off";
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
  // [git] umask for checkout writes (sync, worktree sync, deliver); absent leaves the process's.
  readonly umask?: number;
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
