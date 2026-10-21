import type { HookInput } from "../contract.js";
import { pass, type Policy, type PolicyContext } from "../policies/types.js";
import { readState, writeState } from "./_shared.js";
import { stopOptions } from "./options.js";
import { findProjector, projectionState } from "./projection.js";
import type { CheckState, StopOptions } from "./types.js";

// Defer Codex Stop notices to the next prompt because Codex rejects Stop context.
function notify(
  input: HookInput,
  ctx: PolicyContext<StopOptions>,
  context: string[],
  update: Partial<CheckState> = {},
) {
  if (input.runtime === "claude" && input.session.turnId) {
    writeState(input, ctx, update);
    return { context };
  }
  writeState(input, ctx, { ...update, pending: context });
  return pass;
}

export const onStop: Policy<StopOptions> = {
  id: "checks.on_stop",
  events: ["after_tool", "stop", "prompt"],
  tools: ["edit"],
  fail: "open",
  defaultMode: "warn",
  options: stopOptions,
  evaluate(input, ctx) {
    if (!ctx.options.projectCheck) return pass;
    const state = readState(input, ctx);
    if (input.event === "after_tool") {
      writeState(input, ctx, { edited: true });
      return pass;
    }
    if (input.event === "prompt") {
      if (!state.pending.length) return pass;
      writeState(input, ctx, { pending: [] });
      return { context: state.pending };
    }
    if (input.stop?.active || !state.edited) return pass;
    const turn = input.session.turnId;
    if (turn && state.stopTurn === turn) return pass;
    writeState(input, ctx, { edited: false, stopTurn: turn });
    const deadline = Date.now() + 5000;
    const projector = findProjector(input.projectRoot, ctx.store.dir, deadline);
    if ("missing" in projector) {
      ctx.log.error("projecting pmcp not available");
      if (state.projectorReported) return pass;
      return notify(
        input,
        ctx,
        [`on_stop: projecting pmcp not available (${projector.missing})`],
        { projectorReported: true },
      );
    }
    const projection = projectionState(
      input.projectRoot,
      projector.cli,
      deadline,
    );
    if (projection === "clean") return pass;
    if (projection === "unavailable") {
      ctx.log.error("projection check could not run");
      return pass;
    }
    ctx.log.error("projection drift check failed");
    return notify(input, ctx, [
      "pmcp on_stop: project projection check failed; run pmcp project --check to inspect drift.",
    ]);
  },
};
