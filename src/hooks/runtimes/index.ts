import type { RuntimeId } from "../contract.js";
import { antigravity } from "./antigravity/adapter.js";
import { claude } from "./claude/adapter.js";
import { codex } from "./codex/adapter.js";
import { gemini } from "./gemini/adapter.js";
import { grok } from "./grok/adapter.js";
import { opencode } from "./opencode/adapter.js";
import type { NativeHookFile, RuntimeAdapter } from "./types.js";

export const RUNTIMES: Readonly<Record<RuntimeId, RuntimeAdapter>> = {
  claude,
  codex,
  gemini,
  antigravity,
  grok,
  opencode,
};

// Every native file and key a hook projection may own entries in, across runtimes.
export const NATIVE_HOOK_FILES: readonly NativeHookFile[] = Object.values(
  RUNTIMES,
).flatMap((adapter) => adapter.nativeFiles);

export function runtime(id: string): RuntimeAdapter | undefined {
  return Object.hasOwn(RUNTIMES, id) ? RUNTIMES[id as RuntimeId] : undefined;
}

// The targeted runtime that claims a payload sent to another runtime's projected hook (grok
// running .claude/settings.json), else the runtime the hook was projected for.
export function guestFor(
  host: RuntimeAdapter,
  payload: unknown,
  targets: readonly RuntimeId[],
): RuntimeAdapter {
  const guest = targets
    .map((id) => RUNTIMES[id])
    .find(
      (adapter) =>
        adapter.ridesOn?.runtime === host.id && adapter.ridesOn.claims(payload),
    );
  return guest ?? host;
}
