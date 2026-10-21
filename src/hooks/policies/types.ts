import type {
  Decision,
  HookInput,
  Mode,
  NeutralEvent,
  ToolKind,
} from "../contract.js";
import type { Logger } from "../../logging/logger.js";
import type { SessionStore } from "../../sessions/types.js";

export type PolicyId = string;

export interface Worktree {
  readonly path: string;
  readonly branch: string | null;
}

export interface GitProbe {
  toplevel(cwd: string): string | null;
  worktrees(cwd: string): readonly Worktree[];
}

export interface PolicyContext<Options> {
  readonly options: Options;
  readonly mode: Mode;
  readonly git: GitProbe;
  readonly store: SessionStore;
  readonly log: Logger;
  // The verified sha256 of the policy.json this hook ran under, when known.
  readonly policySha256?: string;
  now(): number;
}

export interface Policy<Options = unknown> {
  readonly id: PolicyId;
  readonly events: readonly NeutralEvent[];
  readonly tools?: readonly ToolKind[];
  readonly fail: "closed" | "open";
  readonly defaultMode: Mode;
  // Narrow bindings by events so policies are not invoked on unrelated runtime events.
  eventsFor?(options: Options): readonly NeutralEvent[];

  options(raw: Readonly<Record<string, unknown>>): Options;
  // Apply configured modes in dispatch so policy severity remains independent of user preferences.
  evaluate(
    input: HookInput,
    ctx: PolicyContext<Options>,
  ): Decision | Promise<Decision>;
}

export const pass: Decision = {};

export function noOptions(raw: Readonly<Record<string, unknown>>): object {
  const unknown = Object.keys(raw);
  if (unknown.length > 0) throw new Error(`unknown option ${unknown[0]}`);
  return {};
}

export function stringList(
  raw: Readonly<Record<string, unknown>>,
  key: string,
): string[] | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new Error(`${key} must be a list of strings`);
  }
  return value;
}

export function onlyKeys(
  raw: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): void {
  const unknown = Object.keys(raw).find((key) => !keys.includes(key));
  if (unknown) throw new Error(`unknown option ${unknown}`);
}
