import { ArgumentError, one, type CommandContext } from "../../cli/command.js";
import { findConfig, readConfig } from "../../config.js";
import { openStore, readStoreSettings } from "../settings.js";
import type { SessionStore } from "../types.js";

export function storeFrom(context: CommandContext): {
  store: SessionStore;
  leases: string[];
  root: string;
} {
  const path = one(context.args, "config") ?? findConfig(context.cwd);
  if (!path)
    throw new ArgumentError("no pmcp.toml here or above; pass --config");
  const config = readConfig(path);
  const sessions = (config.raw["sessions"] ?? {}) as Record<string, unknown>;
  const leases = Object.keys((sessions["leases"] ?? {}) as object);
  return {
    store: openStore(
      config.dir,
      readStoreSettings(sessions, config.raw["git"]),
    ),
    leases,
    root: config.dir,
  };
}

function text(context: CommandContext, verb: string): string {
  const words = context.args.positional.slice(1).join(" ").trim();
  if (!words)
    throw new ArgumentError(
      `pmcp sessions ${verb} needs ${verb === "pause" ? "a reason" : "a message"}`,
    );
  return words;
}

export function change(context: CommandContext, verb: string): number {
  const { store } = storeFrom(context);
  const by = one(context.args, "by") ?? "operator";
  if (verb === "pause") {
    const reason = text(context, verb);
    store.pause.write({ by, reason });
    context.ui.line(`paused: ${reason}`);
    return 0;
  }
  if (verb === "resume") {
    store.pause.write(null);
    context.ui.line("resumed");
    return 0;
  }
  if (verb === "broadcast") {
    const message = text(context, verb);
    store.broadcast.post({ by, text: message });
    context.ui.line(`broadcast: ${message}`);
    return 0;
  }
  if (verb === "unbroadcast") {
    store.broadcast.clear();
    context.ui.line("broadcasts withdrawn");
    return 0;
  }
  const records = store.registry.sweep();
  const expired = store.mailbox.sweep();
  context.ui.line(
    `removed ${records} stale record(s) and ${expired} expired message(s)`,
  );
  return 0;
}

export function status(context: CommandContext): Promise<number> {
  const { store, leases } = storeFrom(context);
  return import("../status.js").then(({ statusLines }) => {
    const lines = statusLines(store, context.cwd, leases);
    if (lines.length > 0) context.ui.data(`${lines.join("\n")}\n`);
    if (lines.length === 0) context.ui.line("no live sessions");
    return 0;
  });
}
