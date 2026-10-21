import type { Decision, HookInput } from "../contract.js";

// Keep continued Stop hooks silent so context cannot restart an endless continuation loop.
export function quietRepeatedStop(
  input: HookInput,
  decision: Decision,
): Decision {
  if (input.event !== "stop" || !input.stop?.active) return decision;
  return {};
}
