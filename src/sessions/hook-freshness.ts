import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { LiveRecord } from "./types.js";

// What a session would need to see the current hooks: the policy.json hash, and the time the
// Codex hook file last changed. Codex reads .codex/hooks.json only when a session starts (seen
// 2026-10-20: a pane started before a re-projection ran no hook on later prompts).
export interface CurrentHooks {
  readonly policySha256: string | null;
  readonly codexHooksChanged: number | null;
}

export function currentHooks(root: string): CurrentHooks {
  const policy = join(root, ".agents/pmcp-hooks/policy.json");
  const codex = join(root, ".codex/hooks.json");
  return {
    policySha256: existsSync(policy)
      ? createHash("sha256").update(readFileSync(policy, "utf8")).digest("hex")
      : null,
    codexHooksChanged: existsSync(codex) ? statSync(codex).mtimeMs : null,
  };
}

const nameOf = (record: LiveRecord) =>
  record.alias || record.session.slice(0, 8);

// One line per live session that should be restarted, with the reason.
export function restartNotes(
  records: readonly LiveRecord[],
  current: CurrentHooks,
): string[] {
  const notes: string[] = [];
  for (const record of records.filter((entry) => entry.live)) {
    const started = Date.parse(record.startedAt ?? "") || 0;
    const codexStale =
      record.runtime === "codex" &&
      current.codexHooksChanged !== null &&
      started < current.codexHooksChanged;
    if (codexStale) {
      notes.push(
        `${nameOf(record)} (codex) started before .codex/hooks.json changed; Codex loads hooks only at start, so restart it`,
      );
      continue;
    }
    const policy = record["startPolicy"];
    if (current.policySha256 && policy !== current.policySha256)
      notes.push(
        `${nameOf(record)}${record.runtime ? ` (${record.runtime})` : ""} started under ${typeof policy === "string" ? "an older" : "an untracked"} pmcp policy; restart it if it should get new hook events`,
      );
  }
  return notes;
}
