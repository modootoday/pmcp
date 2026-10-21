import type { CompiledGuard } from "../compiled.js";
import { afterEdit, onStop } from "../checks/index.js";
import { asTable } from "./types.js";

export function readChecks(raw: unknown): CompiledGuard[] {
  const table = asTable(raw, "[hooks.checks]");
  const definitions = { after_edit: afterEdit, on_stop: onStop };
  return Object.entries(table).map(([name, value]) => {
    const policy = definitions[name as keyof typeof definitions];
    if (!policy) throw new Error(`unknown check hooks.checks.${name}`);
    const options = asTable(value, `[hooks.checks.${name}]`);
    policy.options(options);
    return { id: policy.id, mode: "warn", options };
  });
}
