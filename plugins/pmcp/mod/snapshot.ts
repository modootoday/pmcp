import { atom, update } from "claude-code";
import { hostFiles } from "./host";
import { blocking, byKind, nameOf, stuck, summaryOf, waitingOf } from "./model";
import { readSessionState, type SessionSnapshot } from "./reader/index";
import { state, type Kept } from "./state";

// Retain state through the host because module variables reset when the mod reloads.
const kept = atom(
  { plugin: "pmcp", key: "kept" } as const,
  null as Kept | null,
);

function announce(
  $: any,
  before: SessionSnapshot,
  after: SessionSnapshot,
): void {
  if (!before.pause && after.pause)
    $.ui.toast(`Sessions paused: ${after.pause.reason}`);
  const heard = after.broadcast;
  if (heard && heard.by !== state.self && heard.id !== before.broadcast?.id) {
    $.ui.toast(`Broadcast: ${heard.text}`, { timeoutMs: 10000 });
  }
  if (before.pause && !after.pause) $.ui.toast("Sessions resumed");
  const wasStuck = before.lease ? stuck(before.lease) : false;
  if (after.lease && stuck(after.lease) && !wasStuck)
    $.ui.toast(`A lease has been held for 10 min: ${after.lease.subject}`);
  const waitingBefore = new Set(blocking(before.records).map((r) => r.session));
  for (const record of blocking(after.records)) {
    if (waitingBefore.has(record.session)) continue;
    $.ui.toast(`${nameOf(record)} is asking (${waitingOf(record)})`, {
      timeoutMs: 8000,
    });
  }
}

// Redraw only visible changes so peer activity does not disrupt scrolled views.
function drawnSignature(snapshot: SessionSnapshot): string {
  const band = {
    pause: snapshot.pause,
    lease:
      snapshot.lease && stuck(snapshot.lease) ? snapshot.lease.subject : null,
    broadcast: snapshot.broadcast?.id ?? null,
    asking: blocking(snapshot.records).map((r) => r.session),
    summary: summaryOf(snapshot),
  };
  if (!state.isOpen) return JSON.stringify(band);
  return JSON.stringify({
    band,
    records: snapshot.records,
    lease: snapshot.lease?.subject ?? null,
    tick: Math.floor(state.now / 10_000),
  });
}

export async function refresh($: any): Promise<void> {
  if (!state.settings) return;
  state.now = Number(await $.clock.now());
  const read = await readSessionState(hostFiles($), {
    stateDir: state.stateDir,
    now: state.now,
  });
  const next = { ...read, records: [...read.records].sort(byKind) };
  announce($, state.snapshot, next);
  state.snapshot = next;
  const signature = drawnSignature(next);
  if (signature === state.signature) return;
  state.signature = signature;
  await update($, kept, () => ({
    snapshot: next,
    isOpen: state.isOpen,
    now: state.now,
  }));
  await $.ui.invalidate("ui.render");
}
