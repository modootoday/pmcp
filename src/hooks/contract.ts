export type RuntimeId =
  "claude" | "codex" | "gemini" | "antigravity" | "grok" | "opencode";
export const RUNTIME_IDS: readonly RuntimeId[] = [
  "claude",
  "codex",
  "gemini",
  "antigravity",
  "grok",
  "opencode",
];
// Runtimes [hooks] targets defaults to; the others are opt-in by naming them in targets.
export const DEFAULT_RUNTIME_IDS: readonly RuntimeId[] = ["claude", "codex"];

export type NeutralEvent =
  | "session_start"
  | "prompt"
  | "before_tool"
  | "after_tool"
  | "stop"
  | "session_end"
  | "notification";
export const NEUTRAL_EVENTS: readonly NeutralEvent[] = [
  "session_start",
  "prompt",
  "before_tool",
  "after_tool",
  "stop",
  "session_end",
  "notification",
];

export type ToolKind = "shell" | "edit" | "read" | "other";

export interface ShellStep {
  readonly argv: readonly string[];

  readonly raw: readonly string[];

  readonly assigned: readonly string[];

  readonly dir: string;
}

export interface HookInput {
  readonly contract: 2;
  readonly runtime: RuntimeId;
  readonly event: NeutralEvent;
  readonly session: {
    readonly id: string;
    readonly pid?: number;
    readonly agentType?: string;
    readonly turnId?: string;
    // Where the runtime takes prompts for this session from outside (opencode's server URL).
    readonly wakeUrl?: string;
  };
  readonly cwd: string;
  readonly projectRoot: string;
  readonly tool?: {
    readonly kind: ToolKind;
    readonly native: string;

    readonly command?: string;

    readonly steps?: readonly ShellStep[];
    readonly paths: readonly string[];
  };
  readonly prompt?: string;
  readonly stop?: { readonly lastMessage?: string; readonly active?: boolean };
  readonly notification?: {
    readonly type?: string;
    readonly message?: string;
  };
}

export type Verdict = "allow" | "deny" | "ask";

export interface Decision {
  readonly verdict?: Verdict;
  readonly reason?: string;
  readonly context?: readonly string[];
  readonly feedback?: string;
}

export type Mode = "deny" | "ask" | "warn" | "off" | "graded";
