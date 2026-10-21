import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Decision, HookInput } from "../contract.js";
import type { SessionStore } from "../../sessions/types.js";

// Context a runtime drops at this event (gemini BeforeTool, agy has no prompt event) waits in a
// per-session file and rides the next event whose context reaches the model. A session record
// is not used, so a pending note never makes a session appear in the registry.
const SAFE = /[^A-Za-z0-9_-]/gu;

function file(store: SessionStore, session: string): string {
  return join(
    store.dir,
    "pending-context",
    `${session.replace(SAFE, "_")}.json`,
  );
}

function read(path: string): string[] {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(value)
      ? value.filter((v) => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

function write(path: string, notes: readonly string[]): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(notes));
  renameSync(temporary, path);
}

export function deferContext(
  input: HookInput,
  decision: Decision,
  delivers: readonly HookInput["event"][],
  store: SessionStore,
): Decision {
  const session = input.session.id;
  if (!session) return decision;
  const path = file(store, session);
  if (!delivers.includes(input.event)) {
    if (!decision.context?.length) return decision;
    write(path, [...read(path), ...decision.context]);
    const { context: _held, ...rest } = decision;
    return rest;
  }
  const pending = read(path);
  if (pending.length === 0) return decision;
  write(path, []);
  return { ...decision, context: [...pending, ...(decision.context ?? [])] };
}
