import {
  ArgumentError,
  noConfig,
  one,
  type CommandContext,
} from "../../cli/command.js";
import { findConfig, readConfig } from "../../config.js";
import { inferSession } from "../identity.js";
import { ancestors } from "../liveness.js";
import { isOperator, requireOperatorFor } from "../operator-cli.js";
import { openStore, readStoreSettings } from "../settings.js";
import type { SessionStore } from "../types.js";

const OPERATOR = "operator";

export function storeFrom(context: CommandContext): {
  store: SessionStore;
  leases: string[];
  root: string;
} {
  const path = one(context.args, "config") ?? findConfig(context.cwd);
  if (!path) throw noConfig();
  const config = readConfig(path);
  const sessions = (config.raw["sessions"] ?? {}) as Record<string, unknown>;
  const leases = Object.keys((sessions["leases"] ?? {}) as object);
  return {
    store: openStore(
      config.dir,
      readStoreSettings(sessions, config.raw["git"]),
      context.env,
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

// --by names who acts. Only the operator acts as operator, so an agent cannot sign as one; an
// agent session without --by acts as itself.
export function actor(context: CommandContext, store: SessionStore): string {
  const given = one(context.args, "by");
  if (given !== undefined && given !== OPERATOR) return given;
  if (given === undefined) {
    const found = inferSession(context.env, store.registry.list(), ancestors());
    if (found.session) return found.session;
  }
  if (isOperator(context)) return OPERATOR;
  throw new ArgumentError(
    given === OPERATOR
      ? "--by operator is for the operator's own terminal; name yourself with --by <name>"
      : "say who acts with --by <name>: no agent session or operator terminal was found",
  );
}

export function change(context: CommandContext, verb: string): number {
  const { store } = storeFrom(context);
  if (verb === "pause" || verb === "resume")
    requireOperatorFor(context, `pmcp sessions ${verb}`);
  if (verb === "pause") {
    const reason = text(context, verb);
    store.pause.write({ by: one(context.args, "by") ?? OPERATOR, reason });
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
    store.broadcast.post({ by: actor(context, store), text: message });
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
    context.ui.results.records(lines);
    if (lines.length === 0) context.ui.results.line("no live sessions");
    return 0;
  });
}
