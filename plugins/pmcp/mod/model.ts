import type { Lease, SessionRecord, SessionSnapshot } from "./reader/index";
import { LEASE_STUCK_MS, state } from "./state";

export type Kind = "asking" | "working" | "idle";

export const LOOK: {
  [K in Kind]: { glyph: string; word: string; color: string };
} = {
  asking: { glyph: "◆", word: "asking", color: "permission" },
  working: { glyph: "●", word: "working", color: "claude" },
  idle: { glyph: "○", word: "idle", color: "inactive" },
};

const ORDER: Kind[] = ["asking", "working", "idle"];

const WAITING: { [key: string]: string } = {
  permission_prompt: "permission",
  agent_needs_input: "question",
  idle_prompt: "done",
};

export function nameOf(record: SessionRecord): string {
  return record.alias || record.session.slice(0, 8);
}

export function kindOf(record: SessionRecord): Kind {
  if (record.status === "waiting" && record.waiting !== "idle_prompt")
    return "asking";
  if (record.status === "working") return "working";
  return "idle";
}

export function blocking(records: readonly SessionRecord[]): SessionRecord[] {
  return records.filter(
    (r) => kindOf(r) === "asking" && r.session !== state.self,
  );
}

export function stuck(lease: Lease): boolean {
  return state.now - Date.parse(lease.since ?? "") > LEASE_STUCK_MS;
}

// An empty reason is still a question; older records carry no notification type.
export function waitingOf(record: SessionRecord): string {
  return WAITING[record.waiting ?? ""] ?? (record.waiting || "input");
}

// Name the session whose runtime holds the lease, else the one session working in its cwd.
export function holderOf(
  lease: Lease,
  records: readonly SessionRecord[],
): string {
  const byPid = records.find((r) => r.pid === lease.pid);
  if (byPid) return nameOf(byPid);
  const here = records.filter((r) => lease.cwd && r.worktree === lease.cwd);
  if (here.length === 1) return nameOf(here[0]!);
  return `pid ${lease.pid}`;
}

export function labelOf(record: SessionRecord): string {
  if (record.session === state.self) return `${nameOf(record)} (you)`;
  return nameOf(record);
}

export function byKind(a: SessionRecord, b: SessionRecord): number {
  const order = ORDER.indexOf(kindOf(a)) - ORDER.indexOf(kindOf(b));
  if (order !== 0) return order;
  return labelOf(a).localeCompare(labelOf(b));
}

// A desk is named by its directory: detached linked worktrees have no branch to show.
export function placeOf(record: SessionRecord): string {
  const worktree = record.worktree ?? "";
  const desk = /\/\.claude\/worktrees\/([^/]+)\/?$/u.exec(worktree)?.[1];
  if (desk) return desk;
  if (record.branch) return record.branch;
  return worktree.replace(/\/+$/u, "").split("/").pop() || "-";
}

export function detailOf(record: SessionRecord): string {
  if (kindOf(record) === "asking") return waitingOf(record);
  return record.lastAction ?? "";
}

export function marksOf(record: SessionRecord): string {
  return record.behind ? `↓${record.behind}` : "";
}

// The band animates only while a session works, the same signal the pane's working rows use.
export function bandMark(snapshot: SessionSnapshot): {
  spin: boolean;
  glyph: string;
} {
  const spin = snapshot.records.some((r) => kindOf(r) === "working");
  return { spin, glyph: spin ? LOOK.working.glyph : LOOK.idle.glyph };
}

export type Tone = "paused" | "asking" | "leased" | "working" | "idle";

export function toneOf(snapshot: SessionSnapshot): Tone {
  if (snapshot.pause) return "paused";
  if (blocking(snapshot.records).length > 0) return "asking";
  if (snapshot.lease) return "leased";
  if (snapshot.records.some((r) => kindOf(r) === "working")) return "working";
  return "idle";
}

export const TONE: { [T in Tone]: { color: string; background: string } } = {
  paused: { color: "error", background: "#3a1d22" },
  asking: { color: "permission", background: "#2e2640" },
  leased: { color: "warning", background: "#332b17" },
  working: { color: "claude", background: "#2b2420" },
  idle: { color: "inactive", background: "#22252b" },
};

export function ageOf(stamp: string | undefined, now: number): string {
  const seconds = Math.max(
    0,
    Math.round((now - Date.parse(stamp ?? "")) / 1000),
  );
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

export function headline(snapshot: SessionSnapshot): string {
  const { records } = snapshot;
  const asking = records.filter((r) => kindOf(r) === "asking").length;
  const working = records.filter((r) => kindOf(r) === "working").length;
  const parts = [`${records.length} session${records.length === 1 ? "" : "s"}`];
  if (asking > 0) parts.push(`${asking} asking`);
  if (working > 0) parts.push(`${working} working`);
  return parts.join(" · ");
}

export function summaryOf(snapshot: SessionSnapshot): string {
  const parts = [headline(snapshot)];
  const behind = snapshot.records.filter((r) => (r.behind ?? 0) > 0).length;
  if (behind > 0) parts.push(`${behind} behind`);
  if (snapshot.lease) parts.push(`lease: ${snapshot.lease.subject}`);
  if (snapshot.broadcast) parts.push("broadcast");
  return parts.join(" · ");
}
