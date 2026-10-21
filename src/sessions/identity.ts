import type { LiveRecord } from "./types.js";

// What a shell tool sees of its session (measured 2026-10-20): Claude CLAUDE_CODE_SESSION_ID, Codex
// CODEX_THREAD_ID, agy ANTIGRAVITY_CONVERSATION_ID, grok GROK_SESSION_ID; Gemini and OpenCode none.
// Outer sessions' variables leak into nested runtimes, so the innermost runtime is listed first.
const SESSION_VARIABLES: readonly (readonly [string, string])[] = [
  ["codex", "CODEX_THREAD_ID"],
  ["grok", "GROK_SESSION_ID"],
  ["antigravity", "ANTIGRAVITY_CONVERSATION_ID"],
  ["claude", "CLAUDE_CODE_SESSION_ID"],
];
// Variables that show a command runs inside a runtime even when no session id is exposed.
const MARKERS: readonly (readonly [string, string])[] = [
  ["codex", "CODEX_THREAD_ID"],
  ["grok", "GROK_AGENT"],
  ["antigravity", "ANTIGRAVITY_AGENT"],
  ["opencode", "OPENCODE"],
  ["gemini", "GEMINI_CLI"],
  ["claude", "CLAUDECODE"],
];

export interface InferredSession {
  readonly session?: string;
  readonly runtime?: string;
  readonly via?: "process" | "environment";
}

// The session whose runtime process is this command's nearest ancestor wins; that settles
// nesting and covers runtimes that expose no variable. Otherwise the innermost variable.
export function inferSession(
  env: Readonly<Record<string, string | undefined>>,
  records: readonly LiveRecord[],
  chain: readonly number[],
): InferredSession {
  const live = records.filter(
    (record) => record.live && record.pid !== undefined,
  );
  for (const pid of chain) {
    const record = live.find((entry) => entry.pid === pid);
    if (record)
      return {
        session: record.session,
        ...(record.runtime ? { runtime: record.runtime } : {}),
        via: "process",
      };
  }
  for (const [runtime, name] of SESSION_VARIABLES) {
    const value = env[name];
    if (value) return { session: value, runtime, via: "environment" };
  }
  const marker = MARKERS.find(([, name]) => env[name]);
  return marker ? { runtime: marker[0] } : {};
}
