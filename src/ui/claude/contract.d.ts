// The state contract the plugin manifest names. The host requires it to be self-contained,
// so these shapes repeat src/sessions/types.ts and reader/types.ts for the one kept value.

export type PmcpRecord = {
  readonly session: string;
  readonly worktree?: string;
  readonly status?: "idle" | "working" | "waiting";
  readonly behind?: number;
  readonly [key: string]: unknown;
};

export type PmcpSnapshot = {
  readonly records: readonly PmcpRecord[];
  readonly pause: {
    readonly by: string;
    readonly reason: string;
    readonly since: string;
  } | null;
  readonly lease: {
    readonly pid: number;
    readonly subject: string;
    readonly cwd?: string;
    readonly since: string;
  } | null;
  readonly broadcast: {
    readonly id: string;
    readonly by: string;
    readonly text: string;
    readonly since: string;
  } | null;
};

declare module "claude-code" {
  interface PluginState {
    pmcp: {
      kept: { snapshot: PmcpSnapshot; isOpen: boolean; now: number } | null;
    };
  }
}
