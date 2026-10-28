// Route pushes to the mainline through delivery so replay and gate checks cannot be skipped.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import type { Decision } from "../../contract.js";
import { gitCall } from "../../shell/classify.js";
import { detect } from "../../../git/detect.js";
import { checkoutOf } from "../../../sessions/checkout.js";
import { program, realSteps, shellCall } from "../_shared.js";
import { onlyKeys, pass, type Policy } from "../types.js";

const PUSH = /\bgit\b[^|;&\n]*\spush\b/u;
const REASON =
  "This repository's mainline moves only through pmcp git deliver, which replays, gates and pushes one delivery at a time. Commit, then run pmcp git deliver; other branches, other remotes and other repositories push as usual.";

// [git] remote and [git.mainline] branch as declared; detected per push when absent.
export interface MainlineDeliverOptions {
  readonly remote?: string;
  readonly branch?: string;
}

// git push options whose value is the next word.
const VALUE_OPTIONS = new Set([
  "--repo",
  "--receive-pack",
  "--exec",
  "-o",
  "--push-option",
]);
// Options that push every branch, the mainline with them.
const EVERY_BRANCH = new Set(["--all", "--branches", "--mirror"]);

function sameRepository(dir: string, commonDir: string): boolean {
  return checkoutOf(dir)?.commonDir === commonDir;
}

function gitText(dir: string, args: readonly string[]): string {
  const run = spawnSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    timeout: 5000,
  });
  return run.status === 0 ? run.stdout.trim() : "";
}

function names(ref: string, branch: string): boolean {
  if (ref.includes("*")) return true;
  return [branch, `heads/${branch}`, `refs/heads/${branch}`].includes(ref);
}

// Whether `git push <args>` run in dir would move the mainline on the delivery remote. A dry
// run moves nothing; a push it cannot read is taken as moving it.
export function movesMainline(
  dir: string,
  args: readonly string[],
  options: MainlineDeliverOptions,
): boolean {
  const positional: string[] = [];
  let repo = "";
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index]!;
    if (word === "--") {
      positional.push(...args.slice(index + 1));
      break;
    }
    if (!word.startsWith("-") || word === "-") {
      positional.push(word);
      continue;
    }
    const option = word.split("=")[0]!;
    if (option === "-n" || option === "--dry-run") return false;
    if (/^-[a-zA-Z]+$/u.test(word) && word.includes("n")) return false;
    if (EVERY_BRANCH.has(option)) return true;
    if (VALUE_OPTIONS.has(option) && !word.includes("=")) {
      if (option === "--repo") repo = args[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (option === "--repo") repo = word.slice("--repo=".length);
  }
  const ctx = detect(dir, {
    ...(options.remote ? { remote: options.remote } : {}),
    ...(options.branch ? { mainline: options.branch } : {}),
  });
  const remote = options.remote ?? ctx?.remote ?? "origin";
  const branch = options.branch ?? ctx?.mainline ?? "main";
  const target = positional[0] ?? repo;
  // Another remote named in this repository is not the mainline's; a URL or path may be.
  if (target && target !== remote && /^[\w.-]+$/u.test(target)) return false;
  const current = gitText(dir, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const refspecs = positional.slice(1);
  if (refspecs.length === 0) {
    if (!current) return false;
    const upstream = gitText(dir, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);
    return current === branch || upstream === `${remote}/${branch}`;
  }
  return refspecs.some((spec) => {
    const plain = spec.replace(/^\+/u, "");
    const colon = plain.indexOf(":");
    let dst =
      colon < 0 ? plain : plain.slice(colon + 1) || plain.slice(0, colon);
    if (dst === "HEAD" || dst === "@") dst = current;
    return dst !== "" && names(dst, branch);
  });
}

export const mainlineDeliver: Policy<MainlineDeliverOptions> = {
  id: "git.mainline.deliver",
  events: ["before_tool"],
  tools: ["shell"],
  fail: "closed",
  defaultMode: "deny",
  options(raw) {
    onlyKeys(raw, ["remote", "branch"]);
    const text = (key: string) => {
      const value = raw[key];
      if (value === undefined) return {};
      if (typeof value !== "string" || value === "")
        throw new Error(`${key} must be a name`);
      return { [key]: value };
    };
    return { ...text("remote"), ...text("branch") };
  },
  evaluate(input, ctx): Decision {
    const call = shellCall(input);
    const project = checkoutOf(input.projectRoot);
    if (!call || !project) return pass;
    if (!call.steps) {
      const hit =
        PUSH.test(call.command) && sameRepository(input.cwd, project.commonDir);
      return hit ? { verdict: "deny", reason: REASON } : pass;
    }
    for (const step of realSteps(call.steps)) {
      if (program(step.argv[0]) !== "git") continue;
      const git = gitCall(step.argv);
      if (git.sub !== "push") continue;
      const dir = resolve(input.cwd, step.dir, git.dir);
      if (!sameRepository(dir, project.commonDir)) continue;
      if (movesMainline(dir, step.argv.slice(git.at + 1), ctx.options))
        return { verdict: "deny", reason: REASON };
    }
    return pass;
  },
};
