// Keep installation off session startup so synchronization cannot block the runtime.

import { spawn } from "node:child_process";
import { relative, resolve } from "node:path";

import type { Decision, HookInput } from "../../contract.js";
import { detect } from "../../../git/detect.js";
import { gitText } from "../../../git/exec.js";
import { withUmask } from "../../../git/modes.js";
import { syncWorktree } from "../../../git/worktrees/sync.js";
import type { GitContext, Reporter } from "../../../git/types.js";
import { checkoutOf } from "../../../sessions/checkout.js";
import { pass, type Policy, type PolicyContext } from "../types.js";

export interface WorktreeSyncOptions {
  readonly root: string;
  readonly remote?: string;
  readonly mainline?: string;
  readonly onSessionStart: "fetch_and_move" | "move" | "off";
  readonly betweenPrompts: "move_if_light" | "off";
  readonly installAfterMove: "background" | "foreground" | "off";
  readonly install?: readonly string[];
  readonly installWhen: readonly string[];
  readonly noticePaths: readonly string[];
  readonly followSubmodules: boolean;
  // Every configured lease name; a policy file without the list predates it and held only "lockfile".
  readonly leases?: readonly string[];
  // [git] umask, for the move and the install it starts.
  readonly umask?: number;
}

type Context = PolicyContext<WorktreeSyncOptions>;

// Validate compiled options so hooks refuse policy files the compiler could not have produced.
function options(raw: Readonly<Record<string, unknown>>): WorktreeSyncOptions {
  if (typeof raw["root"] !== "string") throw new Error("root must be a string");
  return raw as unknown as WorktreeSyncOptions;
}

function desk(input: HookInput, opts: WorktreeSyncOptions): GitContext | null {
  const checkout = checkoutOf(input.cwd);
  if (!checkout || checkout.main) return null;
  const desks = resolve(checkout.commonDir, "..", opts.root);
  const inside = relative(desks, checkout.root);
  if (!inside || inside.startsWith("..")) return null;
  return detect(checkout.root, {
    ...(opts.remote ? { remote: opts.remote } : {}),
    ...(opts.mainline ? { mainline: opts.mainline } : {}),
  });
}

// Respect pauses and leases because synchronization could otherwise race another session's changes.
function blocked(input: HookInput, ctx: Context): string | null {
  const pause = ctx.store.pause.read();
  if (pause && pause.by !== input.session.id)
    return `the workspace is paused (${pause.reason})`;
  for (const name of ctx.options.leases ?? ["lockfile"]) {
    const lease = ctx.store.leases.read(name);
    if (lease)
      return `a change under lease ${name} is being delivered (${lease.subject})`;
  }
  return null;
}

function changed(
  root: string,
  from: string,
  paths: readonly string[],
  to = "HEAD",
): string[] {
  if (paths.length === 0) return [];
  return gitText(root, ["diff", "--name-only", from, to, "--", ...paths])
    .split("\n")
    .filter(Boolean);
}

function backgroundInstall(
  root: string,
  command: readonly string[],
  umask: number | undefined,
): void {
  // The child takes the umask at spawn, so it holds after this hook returns.
  const child = withUmask(umask, () =>
    spawn(command[0]!, command.slice(1), {
      cwd: root,
      detached: true,
      stdio: "ignore",
    }),
  );
  child.on("error", () => undefined);
  child.unref();
}

function move(input: HookInput, ctx: Context, git: GitContext): string[] {
  const opts = ctx.options;
  const lines: string[] = [];
  const report: Reporter = {
    info: (line) => lines.push(line),
    warn: (line) => lines.push(line),
  };
  const fetch =
    input.event === "session_start" && opts.onSessionStart === "fetch_and_move";
  const before = gitText(git.root, ["rev-parse", "HEAD"]);
  if (
    input.event === "prompt" &&
    changed(git.root, "HEAD", opts.installWhen, git.upstream).length > 0
  ) {
    return [
      `${git.upstream} changed ${opts.installWhen.join(", ")}; this linked worktree moves at the next session start or with pmcp git worktree sync.`,
    ];
  }
  const install =
    opts.install && opts.installAfterMove === "foreground"
      ? {
          install: {
            command: opts.install,
            when: opts.installWhen,
            stateDir: ctx.store.dir,
          },
        }
      : {};
  const result = syncWorktree({
    ctx: git,
    followSubmodules: opts.followSubmodules,
    fetch,
    report,
    ...install,
    ...(opts.umask !== undefined ? { umask: opts.umask } : {}),
  });
  if (result === "current") return [];
  if (result === "held")
    return lines.map((line) => `Worktree ${git.root}: ${line}`);
  if (
    opts.install &&
    opts.installAfterMove === "background" &&
    changed(git.root, before, opts.installWhen).length > 0
  ) {
    backgroundInstall(git.root, opts.install, opts.umask);
    lines.push(`installing in the background: ${opts.install.join(" ")}`);
  }
  const rules = changed(git.root, before, opts.noticePaths);
  if (rules.length > 0)
    lines.push(
      `These rule files changed with the move; re-read them before going on: ${rules.join(", ")}`,
    );
  return lines.map((line) => `Worktree ${git.root}: ${line}`);
}

export const worktreeSync: Policy<WorktreeSyncOptions> = {
  id: "git.worktrees.sync",
  events: ["session_start", "prompt"],
  fail: "open",
  defaultMode: "warn",
  options,
  evaluate(input, ctx): Decision {
    const opts = ctx.options;
    if (input.event === "session_start" && opts.onSessionStart === "off")
      return pass;
    if (input.event === "prompt" && opts.betweenPrompts === "off") return pass;
    const git = desk(input, opts);
    if (!git) return pass;
    const reason = blocked(input, ctx);
    if (reason)
      return input.event === "session_start"
        ? { context: [`Worktree ${git.root} was not moved: ${reason}.`] }
        : pass;
    const lines = move(input, ctx, git);
    return lines.length > 0 ? { context: lines } : pass;
  },
};
