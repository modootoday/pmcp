// Route repository pushes through delivery so replay and gate checks cannot be skipped.

import { resolve } from "node:path";

import type { Decision } from "../../contract.js";
import { gitCall } from "../../shell/classify.js";
import { checkoutOf } from "../../../sessions/checkout.js";
import { program, realSteps, shellCall } from "../_shared.js";
import { onlyKeys, pass, type Policy } from "../types.js";

const PUSH = /\bgit\b[^|;&\n]*\spush\b/u;
const REASON =
  "This repository's mainline moves only through pmcp git deliver, which replays, gates and pushes one delivery at a time. Commit, then run pmcp git deliver; other repositories push from their own directory.";

function sameRepository(dir: string, commonDir: string): boolean {
  return checkoutOf(dir)?.commonDir === commonDir;
}

export const mainlineDeliver: Policy<object> = {
  id: "git.mainline.deliver",
  events: ["before_tool"],
  tools: ["shell"],
  fail: "closed",
  defaultMode: "deny",
  options(raw) {
    onlyKeys(raw, []);
    return {};
  },
  evaluate(input): Decision {
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
      if (sameRepository(dir, project.commonDir))
        return { verdict: "deny", reason: REASON };
    }
    return pass;
  },
};
