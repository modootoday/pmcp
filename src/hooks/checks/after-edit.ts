import { createHash } from "node:crypto";
import { relative } from "node:path";
import { pass, type Policy } from "../policies/types.js";
import { readState, writeState } from "./_shared.js";
import { runCheck } from "./command.js";
import { afterEditOptions } from "./options.js";
import type { AfterEditOptions } from "./types.js";
import { validators } from "./validators.js";

export const afterEdit: Policy<AfterEditOptions> = {
  id: "checks.after_edit",
  events: ["after_tool"],
  tools: ["edit"],
  fail: "open",
  defaultMode: "warn",
  options: afterEditOptions,
  evaluate(input, ctx) {
    const selected = validators(
      input.projectRoot,
      ctx.options.validatorGlob,
      input.tool?.paths ?? [],
    );
    const context: string[] = [];
    const deadline = Date.now() + 5000;
    for (const validator of selected) {
      const command = ctx.options.command.map((part) =>
        part.replaceAll("{validator}", validator),
      );
      const key = createHash("sha256")
        .update(JSON.stringify(command))
        .digest("hex");
      const stamps = readState(input, ctx).validators;
      const now = Date.now();
      if (
        stamps[key] !== undefined &&
        now >= stamps[key]! &&
        now - stamps[key]! < ctx.options.debounceMs
      )
        continue;
      const kept = Object.entries({ ...stamps, [key]: now }).slice(-128);
      writeState(input, ctx, { validators: Object.fromEntries(kept) });
      if (runCheck(command, input.projectRoot, deadline - Date.now())) continue;
      ctx.log.error("validator check failed", {
        validator: relative(input.projectRoot, validator),
      });
      if (context.length < 20)
        context.push(
          `pmcp after_edit: validation failed for ${relative(input.projectRoot, validator)}; run the configured validator to inspect its output.`,
        );
    }
    return context.length ? { context } : pass;
  },
};
