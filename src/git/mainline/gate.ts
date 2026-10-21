import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

import { git, gitOk, gitText, runCommand } from "../exec.js";
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
): string | null {
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
  for (const name of links) {
    const source = join(mainRoot, name);
    const target = join(tree, name);
    if (existsSync(source) && !existsSync(target)) symlinkSync(source, target);
  }
  return null;
}

export function runGate(
  mainRoot: string,
  tree: string,
  tip: string,
  command: Argv,
  links: readonly string[],
  report: Reporter,
): number {
  const problem = prepareGateTree(mainRoot, tree, tip, links);
  if (problem !== null) {
    report.warn(`the gate did not run: ${problem}`);
    return 1;
  }
  report.info(`gate on ${tip.slice(0, 10)} in ${tree}`);
  return runCommand(command, tree, {
    PMCP_GATE_TIP: tip,
    PMCP_GATE_MAIN: mainRoot,
  });
}
