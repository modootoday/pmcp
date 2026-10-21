// Keep enforcement in hooks so the mod only presents state and relays operator choices.
import { atom, read, type On } from "claude-code";
import { runCommand } from "./commands";
import { drawBand, drawPane } from "./draw";
import { holdForeignEdit } from "./guard";
import { findSettings, resolveStateDir } from "./host";
import { refresh } from "./snapshot";
import { EDITS, PANE_ID, POLL_MS, state, type Kept } from "./state";

// The same host-kept value snapshot.ts updates; declared here so the host scan can follow it.
const kept = atom(
  { plugin: "pmcp", key: "kept" } as const,
  null as Kept | null,
);

async function start($: any, e: any): Promise<void> {
  state.self = await $.session.id();
  const cwd = String(e?.cwd ?? (await $.env.get("PWD")) ?? "");
  const found = await findSettings($, cwd);
  if (!found) return;
  const stateDir = await resolveStateDir($, found.root, found.settings);
  if (!stateDir) return;
  state.root = found.root;
  state.settings = found.settings;
  state.stateDir = stateDir;
  const saved = await read($, kept);
  if (saved) {
    state.snapshot = saved.snapshot;
    state.isOpen = saved.isOpen;
    state.now = saved.now;
  }
  if (found.settings.commands) {
    await $.command
      .register({
        name: "pmcp",
        description:
          "Sessions pane; /pmcp pause <reason> stops every other session, /pmcp resume lifts it, /pmcp broadcast <text> tells every session",
        argumentHint:
          "[pause <reason> | resume | broadcast <text> | unbroadcast]",
      })
      .catch(() => undefined);
  }
  $.clock.every(POLL_MS, () => {
    void refresh($).catch(() => undefined);
  });
  await refresh($).catch(() => undefined);
}

export function register(on: On): void {
  on("session.start", async ($: any, e: any, next: any) => {
    await start($, e).catch(() => undefined);
    return next(e);
  });
  on("command.run", { command: "pmcp" }, async ($: any, e: any, next: any) =>
    state.settings?.commands ? runCommand($, String(e.args ?? "")) : next(e),
  );
  on("ui.render", { component: "Pane" }, async ($: any, e: any, next: any) =>
    e.requestId === PANE_ID && state.settings?.sessionsPane
      ? drawPane($, e)
      : next(e),
  );
  on(
    "ui.render",
    { component: "AbovePrompt" },
    async ($: any, e: any, next: any) =>
      state.settings?.statusBand ? drawBand($, e, next) : next(e),
  );
  on("tool.call", { tool: EDITS }, async ($: any, e: any, next: any) =>
    state.settings?.holdForeignEdits
      ? holdForeignEdit($, e, next).catch(() => next(e))
      : next(e),
  );
}
