import type { Decision, HookInput, Mode } from "../contract.js";
import type { Logger } from "../../logging/logger.js";
import type { GitProbe, Policy, PolicyContext } from "../policies/types.js";
import type { SessionStore } from "../../sessions/types.js";
import { applyMode } from "./compose.js";

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
  now(): number;
}

export interface PolicyObservation {
  readonly policy: string;
  readonly mode: Mode;
  readonly decision: Decision;
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
  const finish = (decision: Decision): Decision => {
    deps.onPolicy?.({
      policy: policy.id,
      mode,
      decision,
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
    const raw = await (deps.evaluate
      ? deps.evaluate(selected, input, context)
      : policy.evaluate(input, context));
    const decision = applyMode(policy.id, raw, mode);
    log.debug("policy", {
      verdict: decision.verdict,
      duration_ms: deps.now() - started,
    });
    return finish(decision);
  } catch (error) {
    log.error("policy failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    if (policy.fail === "open") return finish({});
    return finish({
      verdict: "deny",
      reason: `pmcp ${policy.id} failed, refusing to be safe`,
    });
  }
}
