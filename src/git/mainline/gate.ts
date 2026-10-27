import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { git, gitOk, gitText, runCommandLogged } from "../exec.js";
import { reportModes, restoreModes, restoreSubmoduleModes } from "../modes.js";
import type { Argv, Reporter } from "../types.js";

export interface GateTree {
  readonly tree: string;

  readonly lock: string;
}

export function gateTree(tree: string): GateTree {
  return { tree, lock: join(dirname(tree), "lock") };
}

function submodules(mainRoot: string, tree: string): string | null {
  const listed = gitText(tree, ["ls-files", "-s"]).split("\n");
  for (const line of listed) {
    if (!line.startsWith("160000 ")) continue;
    const path = line.split("\t")[1] ?? "";
    const local = join(mainRoot, path);
    if (!path || !existsSync(join(local, ".git"))) continue;
    const pin = gitText(tree, ["rev-parse", `HEAD:${path}`]);
    if (pin && !gitOk(local, ["cat-file", "-e", `${pin}^{commit}`]))
      git(local, ["fetch", "-q", "origin"]);
    const fromLocal = [
      "-c",
      "protocol.file.allow=always",
      "-c",
      `submodule.${path}.url=${local}`,
    ];
    const update = ["submodule", "update", "--init", "--force", "-q", path];
    if (gitOk(tree, [...fromLocal, ...update])) continue;
    const remote = git(tree, update);
    if (remote.status !== 0)
      return `submodule ${path} failed: ${remote.stderr.trim()}`;
  }
  return null;
}

export function prepareGateTree(
  mainRoot: string,
  tree: string,
  tip: string,
  links: readonly string[],
  report?: Reporter,
): string | null {
  // With report, rewritten tracked files get their index mode back ([git] umask).
  const before = existsSync(join(tree, ".git"))
    ? gitText(tree, ["rev-parse", "-q", "--verify", "HEAD"]) || null
    : null;
  if (!existsSync(join(tree, ".git"))) {
    git(mainRoot, ["worktree", "prune"]);
    mkdirSync(dirname(tree), { recursive: true });
    const added = git(mainRoot, [
      "worktree",
      "add",
      "-q",
      "--detach",
      tree,
      tip,
    ]);
    if (added.status !== 0)
      return `gate tree add failed: ${added.stderr.trim()}`;
  }
  if (existsSync(join(tree, ".git"))) {
    const moved = git(tree, ["checkout", "-q", "--detach", "--force", tip]);
    if (moved.status !== 0)
      return `gate tree checkout failed: ${moved.stderr.trim()}`;
    git(tree, ["clean", "-fdq"]);
  }
  const problem = submodules(mainRoot, tree);
  if (problem !== null) return problem;
  if (report)
    reportModes(report, [
      ...restoreModes(tree, before, tip),
      ...(before ? restoreSubmoduleModes(tree, before, tip) : []),
    ]);
  for (const name of links) {
    const source = join(mainRoot, name);
    const target = join(tree, name);
    if (existsSync(source) && !existsSync(target)) symlinkSync(source, target);
  }
  return null;
}

const KEEP_LOGS = 20;

// <UTC>-<tip>.log, so the names sort by time; only the newest KEEP_LOGS stay.
export function gateLog(dir: string, tip: string): string {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const logs = readdirSync(dir)
    .filter((name) => name.endsWith(".log"))
    .sort();
  for (const old of logs.slice(0, Math.max(0, logs.length - KEEP_LOGS + 1)))
    rmSync(join(dir, old), { force: true });
  return join(dir, `${stamp}-${tip.slice(0, 10)}.log`);
}

export interface GateRun {
  readonly code: number;
  // The full output, or null when the gate did not start.
  readonly log: string | null;
}

export function runGate(
  mainRoot: string,
  tree: string,
  tip: string,
  command: Argv,
  links: readonly string[],
  report: Reporter,
  lockEnv?: string,
  logDir: string = join(dirname(tree), "logs"),
  restore = false,
): GateRun {
  const problem = prepareGateTree(
    mainRoot,
    tree,
    tip,
    links,
    restore ? report : undefined,
  );
  if (problem !== null) {
    report.warn(`the gate did not run: ${problem}`);
    return { code: 1, log: null };
  }
  const log = gateLog(logDir, tip);
  report.info(`gate on ${tip.slice(0, 10)} in ${tree}; gate log: ${log}`);
  const code = runCommandLogged(command, tree, log, {
    PMCP_GATE_TIP: tip,
    PMCP_GATE_MAIN: mainRoot,
    ...(lockEnv ? { [lockEnv]: "1" } : {}),
  });
  if (code !== 0)
    report.warn(`the gate failed (exit ${code}); full gate log: ${log}`);
  return { code, log };
}
