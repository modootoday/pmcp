import type { CompiledPolicy } from "../compiled.js";
import type { HookInput } from "../contract.js";
import { dispatch } from "../dispatch.js";
import type { PolicyObservation } from "../dispatch/run-policy.js";
import { silentLogger } from "../../logging/logger.js";
import { gitProbe } from "../policies/git-probe.js";
import type { SessionStore } from "../../sessions/types.js";
import { sourceFor } from "./source.js";

export async function simulate(
  input: HookInput,
  compiled: CompiledPolicy,
  store: SessionStore,
) {
  const policies: (PolicyObservation & {
    skipped: boolean;
    source: string;
    verdict: string;
    reason: string | null;
  })[] = [];
  const skipped = new Set<string>();
  const decision = await dispatch(input, compiled, {
    log: silentLogger,
    git: gitProbe,
    store,
    now: Date.now,
    evaluate(selected, event, context) {
      const id = selected.policy.id;
      if (
        id.startsWith("custom.") ||
        id.startsWith("checks.") ||
        id === "git.worktrees.sync"
      ) {
        skipped.add(id);
        return { context: ["Simulation skipped external effects for " + id] };
      }
      return selected.policy.evaluate(event, context);
    },
    onPolicy(result) {
      policies.push({
        ...result,
        source: sourceFor(result.policy),
        skipped: skipped.has(result.policy),
        verdict: result.decision.verdict ?? "allow",
        reason:
          result.decision.reason ?? result.decision.context?.join("\n") ?? null,
      });
    },
  });
  return { decision, policies };
}
