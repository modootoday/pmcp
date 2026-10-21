import type { CompiledPolicy } from "./compiled.js";
import type { Decision, HookInput } from "./contract.js";
import { compose, lower } from "./dispatch/compose.js";
import { deferContext } from "./dispatch/defer.js";
import { emergencyActive, protectOffFile } from "./dispatch/emergency.js";
import { withSteps } from "./dispatch/enrich.js";
import { runPolicy, type RunDeps } from "./dispatch/run-policy.js";
import { selectPolicies } from "./dispatch/select.js";
import { quietRepeatedStop } from "./dispatch/stop-loop.js";
import { RUNTIMES } from "./runtimes/index.js";

export type { RunDeps as DispatchDeps } from "./dispatch/run-policy.js";

export async function dispatch(
  raw: HookInput,
  compiled: CompiledPolicy,
  deps: RunDeps,
): Promise<Decision> {
  const input = withSteps(raw);
  const protect = protectOffFile(input, compiled.emergencyOffFile);
  const off = emergencyActive(input.projectRoot, compiled.emergencyOffFile);
  const selected = off ? [] : selectPolicies(compiled, input);
  if (off) deps.log.warn("emergency off file present; guards pass");
  const decisions = await Promise.all(
    selected.map((entry) =>
      runPolicy(entry, input, {
        ...deps,
        ...(compiled.failure ? { failure: compiled.failure } : {}),
      }),
    ),
  );
  const composed = lower(
    compose([protect, ...decisions]),
    compiled.lowering[input.runtime],
  );
  // A continued Stop is kept silent, so held context waits for the next event instead.
  const continued = input.event === "stop" && input.stop?.active === true;
  const delivers = continued
    ? []
    : RUNTIMES[input.runtime].capabilities.context;
  return deferContext(
    input,
    quietRepeatedStop(input, composed),
    delivers,
    deps.store,
  );
}
