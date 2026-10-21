// Check the compiled hash so unreviewed policy edits cannot change enforcement.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { MailboxSettings } from "../sessions/types.js";
import type { GateLocation, LeaseFiles } from "../sessions/lease-files.js";
import type { FailureSettings } from "./dispatch/failure.js";
import type { Mode, RuntimeId } from "./contract.js";
import {
  rememberVerified,
  stampOf,
  verifiedBefore,
} from "./integrity-cache.js";
import type { LogSettings } from "../logging/settings.js";

export const HOOK_DIRECTORY = ".agents/pmcp-hooks";
export const POLICY_FILE = `${HOOK_DIRECTORY}/policy.json`;
export const HOOK_FILE = `${HOOK_DIRECTORY}/hook.mjs`;
export const HOOK_BODY_FILE = `${HOOK_DIRECTORY}/hook-body.mjs`;
export const LOCK_FILE = "pmcp.lock";

export type AskFallback = "deny" | "warn";

export interface CompiledGuard {
  readonly id: string;
  readonly mode: Mode;

  readonly options: Readonly<Record<string, unknown>>;
}

export interface CompiledCustom {
  readonly name: string;
  readonly command: readonly string[];
  readonly event: "before_shell" | "after_edit";
  readonly targets: readonly RuntimeId[];
  readonly timeoutMs: number;
  readonly guardSha256: string;
}

export interface CompiledPolicy {
  readonly contract: 2;
  // Set by readCompiled from the lock-verified hash; never written to policy.json.
  readonly policySha256?: string;
  readonly targets: readonly RuntimeId[];
  readonly emergencyOffFile?: string;
  // [hooks.failure], only when declared.
  readonly failure?: FailureSettings;

  readonly stateDir?: string;

  readonly logFile?: string;
  readonly log: LogSettings;
  readonly sessions: {
    readonly staleMs: number;
    readonly keepBroadcasts: number;
    // Absent in policies compiled before the mailbox; the store then keeps it off.
    readonly mailbox?: MailboxSettings;
    readonly leaseFiles?: Readonly<Record<string, LeaseFiles>>;
    readonly gate?: GateLocation;
  };
  readonly guards: readonly CompiledGuard[];
  readonly custom: readonly CompiledCustom[];

  readonly lowering: Readonly<
    Partial<Record<RuntimeId, { readonly ask: AskFallback }>>
  >;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export class PolicyIntegrityError extends Error {}

const MISMATCH =
  "policy.json does not match pmcp.lock; review the change and run pmcp project";

export function readCompiled(root: string): CompiledPolicy {
  const policyPath = join(root, POLICY_FILE);
  const files = [policyPath, join(root, LOCK_FILE)];
  const before = stampOf(files);
  const text = readFileSync(policyPath, "utf8");
  const lock = JSON.parse(readFileSync(files[1]!, "utf8")) as {
    outputs?: { path?: unknown; sha256?: unknown }[];
  };
  const entry = lock.outputs?.find((output) => output.path === POLICY_FILE);
  const expected = typeof entry?.sha256 === "string" ? entry.sha256 : null;
  if (expected === null) throw new PolicyIntegrityError(MISMATCH);
  // Trust a cached verdict only when neither file changed while it was read.
  const stamp = before !== null && before === stampOf(files) ? before : null;
  const cached = stamp !== null && verifiedBefore(policyPath, stamp, expected);
  if (!cached) {
    if (expected !== sha256(text)) throw new PolicyIntegrityError(MISMATCH);
    if (stamp !== null) rememberVerified(policyPath, stamp, expected);
  }
  const compiled = JSON.parse(text) as CompiledPolicy;
  if (compiled.contract !== 2)
    throw new PolicyIntegrityError("Unknown policy.json contract");
  // The verified hash travels with the policy; it is never read from the file itself.
  return { ...compiled, policySha256: expected };
}
