import type { CompiledGuard } from "../compiled.js";
import type { Mode } from "../contract.js";
import { GUARDS } from "../policies/index.js";
import { asTable, type Table } from "./types.js";
import { compareIdentifiers } from "./order.js";

const MODES: readonly Mode[] = ["deny", "ask", "warn", "off", "graded"];
const GROUPS = ["shell", "git"];

function readGuard(id: string, raw: unknown): CompiledGuard | null {
  const policy = GUARDS[id];
  if (!policy) throw new Error(`unknown guard hooks.guards.${id}`);
  const { mode = policy.defaultMode, ...options } = asTable(
    raw,
    `[hooks.guards.${id}]`,
  );
  if (!MODES.includes(mode as Mode))
    throw new Error(
      `[hooks.guards.${id}] mode must be one of ${MODES.join(", ")}`,
    );
  if (mode === "graded" && policy.defaultMode !== "graded") {
    throw new Error(
      `[hooks.guards.${id}] graded applies only to guards that grade their findings`,
    );
  }
  if (mode === "off") return null;
  try {
    policy.options(options);
  } catch (error) {
    throw new Error(
      `[hooks.guards.${id}] ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { id, mode: mode as Mode, options };
}

export function readGuards(guards: Table): CompiledGuard[] {
  const found: CompiledGuard[] = [];
  for (const [group, value] of Object.entries(guards)) {
    if (group === "custom") continue;
    if (!GROUPS.includes(group))
      throw new Error(`unknown guard group hooks.guards.${group}`);
    for (const [name, raw] of Object.entries(
      asTable(value, `[hooks.guards.${group}]`),
    )) {
      const guard = readGuard(`${group}.${name}`, raw);
      if (guard) found.push(guard);
    }
  }
  return found.sort((a, b) => compareIdentifiers(a.id, b.id));
}
