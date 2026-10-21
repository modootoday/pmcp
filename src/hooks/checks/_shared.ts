import type { HookInput } from "../contract.js";
import type { PolicyContext } from "../policies/types.js";
import type { CheckState } from "./types.js";

export function readState(
  input: HookInput,
  ctx: PolicyContext<unknown>,
): CheckState {
  const raw = ctx.store.registry.get(input.session.id)?.["checks"] as
    Partial<CheckState> | undefined;
  return {
    validators: raw?.validators ?? {},
    edited: raw?.edited === true,
    stopTurn: raw?.stopTurn,
    pending: raw?.pending ?? [],
    projectorReported: raw?.projectorReported === true,
  };
}

export function writeState(
  input: HookInput,
  ctx: PolicyContext<unknown>,
  update: Partial<CheckState>,
): void {
  ctx.store.registry.upsert(input.session.id, {
    checks: { ...readState(input, ctx), ...update },
  });
}
