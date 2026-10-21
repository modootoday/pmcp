import { isAbsolute, relative, resolve } from "node:path";

import type { Decision, HookInput } from "../contract.js";
import { checkoutOf } from "../../sessions/checkout.js";

// [hooks.failure]: what a guard that failed to evaluate (threw or ran past timeout_ms, after
// retry more tries) means for the call. A guard's own deny is never affected. Without the
// table a failed fail-closed guard refuses, as it always did.

export const PASS_KINDS = ["read", "edit-own-worktree"] as const;
export type PassKind = (typeof PASS_KINDS)[number];

export interface FailureSettings {
  readonly timeoutMs: number;
  readonly retry: number;
  readonly pass: readonly PassKind[];
}

export function readFailure(value: unknown): FailureSettings | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("[hooks.failure] must be a table");
  const table = value as Record<string, unknown>;
  for (const key of Object.keys(table))
    if (!["timeout_ms", "retry", "pass"].includes(key))
      throw new Error(`[hooks.failure] unknown key ${key}`);
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const v = table[key] ?? fallback;
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max)
      throw new Error(
        `[hooks.failure] ${key} must be an integer from ${min} to ${max}`,
      );
    return v;
  };
  const pass = table["pass"] ?? [];
  if (
    !Array.isArray(pass) ||
    !pass.every((kind) => (PASS_KINDS as readonly unknown[]).includes(kind))
  )
    throw new Error(
      `[hooks.failure] pass must list ${PASS_KINDS.join(" or ")}`,
    );
  return {
    timeoutMs: integer("timeout_ms", 2000, 100, 60000),
    retry: integer("retry", 1, 0, 3),
    pass: [...new Set(pass as PassKind[])],
  };
}

// Inside the checkout the session works in, and that checkout is a linked worktree: the shared
// main checkout is never anyone's own.
function ownWorktree(input: HookInput): boolean {
  const checkout = checkoutOf(input.cwd);
  if (!checkout || checkout.main) return false;
  const paths = input.tool?.paths ?? [];
  return (
    paths.length > 0 &&
    paths.every((path) => {
      const rest = relative(checkout.root, resolve(input.cwd, path));
      return rest !== "" && !rest.startsWith("..") && !isAbsolute(rest);
    })
  );
}

export function passes(input: HookInput, pass: readonly PassKind[]): boolean {
  const kind = input.tool?.kind;
  if (kind === "read") return pass.includes("read");
  if (kind === "edit")
    return pass.includes("edit-own-worktree") && ownWorktree(input);
  return false;
}

// One line, the same for the person and the model: which guard, why, and what happened.
export function afterFailure(
  policy: string,
  cause: string,
  input: HookInput,
  failure: FailureSettings,
): Decision {
  const head = `pmcp hooks: ${policy} failed (${cause})`;
  if (passes(input, failure.pass))
    return { context: [`${head}; passed with a warning`] };
  return { verdict: "deny", reason: `${head}; refused` };
}
