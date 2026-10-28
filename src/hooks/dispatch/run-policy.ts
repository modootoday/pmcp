import type { Decision, HookInput, Mode } from "../contract.js";
import type { Logger } from "../../logging/logger.js";
import type { GitProbe, Policy, PolicyContext } from "../policies/types.js";
import type { SessionStore } from "../../sessions/types.js";
import { applyMode } from "./compose.js";
import { afterFailure, type FailureSettings } from "./failure.js";

class Timeout extends Error {}

function within<T>(work: Promise<T>, ms: number | undefined): Promise<T> {
  if (ms === undefined) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Timeout(`timeout ${ms} ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

export interface Selected {
  readonly policy: Policy<any>;
  readonly mode: Mode;
  readonly options: Readonly<Record<string, unknown>>;
}

export interface RunDeps {
  readonly evaluate?: (
    selected: Selected,
    input: HookInput,
    context: PolicyContext<any>,
  ) => Decision | Promise<Decision>;
  readonly onPolicy?: (result: PolicyObservation) => void;
  readonly log: Logger;
  readonly git: GitProbe;
  readonly store: SessionStore;
  // The verified sha256 of policy.json this hook ran under.
  readonly policySha256?: string;
  readonly failure?: FailureSettings;
  now(): number;
}

export interface PolicyObservation {
  readonly policy: string;
  readonly mode: Mode;
  readonly decision: Decision;
  // What the policy itself returned, before its mode; absent when it failed to evaluate.
  readonly raw?: Decision;
  readonly durationMs: number;
}

// Fail guards closed while allowing bookkeeping failures to preserve session availability.
export async function runPolicy(
  selected: Selected,
  input: HookInput,
  deps: RunDeps,
): Promise<Decision> {
  const { policy, mode } = selected;
  const log = deps.log.child({ policy: policy.id });
  const started = deps.now();
  const finish = (decision: Decision, raw?: Decision): Decision => {
    deps.onPolicy?.({
      policy: policy.id,
      mode,
      decision,
      ...(raw ? { raw } : {}),
      durationMs: deps.now() - started,
    });
    return decision;
  };
  try {
    const options = policy.options(selected.options);
    const context = {
      options,
      mode,
      git: deps.git,
      store: deps.store,
      log,
      now: deps.now,
      ...(deps.policySha256 ? { policySha256: deps.policySha256 } : {}),
    };
    const evaluate = () =>
      Promise.resolve(
        deps.evaluate
          ? deps.evaluate(selected, input, context)
          : policy.evaluate(input, context),
      );
    // With [hooks.failure], each try is bounded and a failed one runs again before it counts.
    const tries = (deps.failure?.retry ?? 0) + 1;
    let raw: Decision | undefined;
    for (let attempt = 1; ; attempt += 1) {
      try {
        raw = await within(evaluate(), deps.failure?.timeoutMs);
        break;
      } catch (error) {
        if (attempt >= tries) throw error;
        log.warn("policy failed; trying again", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const decision = applyMode(policy.id, raw, mode);
    // What the guard found and what the call got, so a guard in warn or observe can be compared
    // with the hook it shadows. Never the command, the reason or the prompt.
    log.debug("policy", {
      raw: raw.verdict ?? "allow",
      mode,
      verdict: decision.verdict ?? "allow",
      ...(input.tool
        ? { tool: input.tool.kind, native: input.tool.native }
        : {}),
      duration_ms: deps.now() - started,
    });
    return finish(decision, raw);
  } catch (error) {
    log.error("policy failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    // An observed guard never decides, failed or not.
    if (policy.fail === "open" || mode === "observe") return finish({});
    if (deps.failure) {
      const cause =
        error instanceof Timeout
          ? error.message
          : `error: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}`;
      return finish(afterFailure(policy.id, cause, input, deps.failure));
    }
    return finish({
      verdict: "deny",
      reason: `pmcp ${policy.id} failed, refusing to be safe`,
    });
  }
}
