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
  const policies: (Omit<PolicyObservation, "raw"> & {
    skipped: boolean;
    source: string;
    verdict: string;
    reason: string | null;
    // What the guard found before its mode: an observe, warn or graded guard's deny shows here.
    raw: { verdict: string; reason: string | null } | null;
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
        raw: result.raw
          ? {
              verdict: result.raw.verdict ?? "allow",
              reason:
                result.raw.reason ?? result.raw.context?.join("\n") ?? null,
            }
          : null,
      });
    },
  });
  return { decision, policies };
}
