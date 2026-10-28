import type { CompiledGuard } from "../compiled.js";
import type { Mode } from "../contract.js";
import { FEATURES } from "../policies/index.js";
import {
  readStoreSettings,
  type StoreSettings,
} from "../../sessions/settings.js";
import { asTable, type Table } from "./types.js";

export interface SessionsTable extends StoreSettings {
  readonly declared: boolean;
  readonly guards: CompiledGuard[];
}

const KEYS = [
  "store",
  "state_dir",
  "pause_file",
  "registry",
  "pause",
  "broadcast",
  "leases",
  "roles",
  "mailbox",
];
const MODES: readonly Mode[] = ["deny", "ask", "warn", "off"];

function guard(id: string, options: Table, mode: Mode): CompiledGuard {
  try {
    FEATURES[id]!.options(options);
  } catch (error) {
    throw new Error(
      `[${id}] ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { id, mode, options };
}

function pauseGuard(raw: unknown): CompiledGuard {
  const { mode = "deny", ...options } = asTable(raw, "[sessions.pause]");
  if (!MODES.includes(mode as Mode))
    throw new Error(`[sessions.pause] mode must be one of ${MODES.join(", ")}`);
  return guard("sessions.pause", options, mode as Mode);
}

function registryCheck(raw: unknown): void {
  const { liveness = "pid_heartbeat", ...rest } = asTable(
    raw,
    "[sessions.registry]",
  );
  if (liveness !== "pid_heartbeat")
    throw new Error('[sessions.registry] liveness must be "pid_heartbeat"');
  const unknown = Object.keys(rest).find((key) => key !== "stale_minutes");
  if (unknown) throw new Error(`[sessions.registry] unknown key ${unknown}`);
}

// Compile the registry first so later policies can observe the current session.
export function readSessions(raw: unknown, git?: unknown): SessionsTable {
  const table = asTable(raw, "[sessions]");
  const unknown = Object.keys(table).find((key) => !KEYS.includes(key));
  if (unknown) throw new Error(`[sessions] unknown key ${unknown}`);
  const settings = readStoreSettings(raw, git);
  registryCheck(table["registry"]);
  const guards: CompiledGuard[] = [];
  if (table["registry"] !== undefined)
    guards.push(guard("sessions.registry", {}, "warn"));
  if (table["pause"] !== undefined) guards.push(pauseGuard(table["pause"]));
  if (table["leases"] !== undefined)
    guards.push(
      guard(
        "sessions.leases",
        asTable(table["leases"], "[sessions.leases]"),
        "deny",
      ),
    );
  if (table["roles"] !== undefined)
    guards.push(
      guard(
        "sessions.roles",
        asTable(table["roles"], "[sessions.roles]"),
        "deny",
      ),
    );
  if (table["broadcast"] !== undefined) {
    const { keep: _keep, ...options } = asTable(
      table["broadcast"],
      "[sessions.broadcast]",
    );
    guards.push(guard("sessions.broadcast", options, "warn"));
  }
  // The roles travel with the mailbox guard so role:<name> selectors resolve at delivery.
  if (settings.mailbox?.enabled)
    guards.push(
      guard(
        "sessions.mailbox",
        { roles: asTable(table["roles"] ?? {}, "[sessions.roles]") },
        "warn",
      ),
    );
  return {
    ...settings,
    declared: guards.length > 0,
    guards: guards.filter((entry) => entry.mode !== "off"),
  };
}
