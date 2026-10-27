import type {
  Decision,
  HookInput,
  NeutralEvent,
  RuntimeId,
  ToolKind,
} from "../contract.js";

// Keep unmeasured support distinct so compilation cannot promise unverified runtime behavior.
export type Support = "measured" | "unqualified" | "unsupported";
export type Output = "deny" | "ask" | "context" | "feedback";

export interface Capabilities {
  readonly events: Readonly<Record<NeutralEvent, Support>>;
  readonly outputs: Readonly<Record<Output, Support>>;
  // Events whose context reaches the model; dispatch holds other context for the next of these.
  readonly context: readonly NeutralEvent[];
}

export interface NativeBinding {
  readonly event: NeutralEvent;
  readonly native: string;
  readonly matcher?: string;
  readonly timeoutSec: number;
}

export interface HookProjection {
  readonly bindings: readonly NativeBinding[];
}

export interface FileEdit {
  readonly file: string;
  readonly key: readonly string[];
  readonly entries: readonly unknown[];
}

// A whole file the runtime loads, for runtimes whose extension point is code, not configuration.
export interface ProjectedFile {
  readonly path: string;
  readonly content: string;
}

// The native file a runtime's projection owns entries in, and the key those entries live under.
export interface NativeHookFile {
  readonly file: string;
  readonly root: string;
}

export interface RuntimeAdapter {
  synthetic(options: SyntheticOptions): Record<string, unknown>;
  readonly id: RuntimeId;
  readonly capabilities: Capabilities;
  bindings(
    event: NeutralEvent,
    tools: readonly ToolKind[],
    timeoutSec: number,
  ): NativeBinding[];

  normalize(
    nativeEvent: string,
    payload: unknown,
    projectRoot: string,
  ): HookInput | null;
  render(
    input: HookInput,
    decision: Decision,
  ): { stdout: string; exitCode: number };
  // A before_tool answer this adapter printed, read back as its verdict; null when unreadable.
  readVerdict(stdout: string): "allow" | "deny" | "ask" | null;
  project(plan: HookProjection): FileEdit[];
  files?(plan: HookProjection): ProjectedFile[];
  readonly nativeFiles: readonly NativeHookFile[];

  nativeEvent(event: NeutralEvent): string | undefined;
  // What the hook prints when it has no opinion, for a runtime that reads silence as a refusal.
  silent?(event: NeutralEvent): string;
  // A runtime that also runs another runtime's projected hooks: when both are targets only the
  // other projects, and the entry hands a payload this runtime claims to this adapter.
  readonly ridesOn?: {
    readonly runtime: RuntimeId;
    claims(payload: unknown): boolean;
  };
  // folder: the runtime skips project hooks until the user trusts the folder.
  readonly trust: "none" | "hash_review" | "folder";
}

export interface SyntheticOptions {
  readonly cwd: string;
  readonly session: string;
  readonly event: string;
  readonly command?: string;
  readonly path?: string;
  readonly tool?: string;
}
