import {
  ArgumentError,
  EXIT,
  one,
  type CommandContext,
} from "../cli/command.js";
import type { LeaseSettings } from "../lease/config.js";
import {
  cancelWaiter,
  findRunning,
  promote,
  reprioritize,
  type ControlResult,
  type Who,
} from "../lease/control.js";
import { leasePaths } from "../lease/files.js";
import { sessionOf } from "../lease/queue.js";
import { statusJson } from "../lease/status-json.js";
import { requireOperatorFor } from "../sessions/operator-cli.js";
import {
  cancel as cancelTicket,
  ticketExists,
  ticketOwner,
  writeResult,
} from "../lease/tickets.js";

// queue, promote, priority and cancel by id. Every change needs a reason and is logged.

function who(context: CommandContext): Who {
  return {
    uid: process.getuid?.() ?? null,
    session: sessionOf(context.env, context.cwd),
  };
}

function reason(context: CommandContext, required: boolean): string {
  const text = one(context.args, "reason")?.trim() ?? "";
  if (required && !text)
    throw new ArgumentError("say why with --reason <text>");
  return text || "none given";
}

function report(context: CommandContext, result: ControlResult): number {
  if (!result.ok) {
    context.ui.error(result.why);
    return EXIT.failure;
  }
  context.ui.data(
    `${result.record.id} ${result.record.lane} ${result.record.label}\n`,
  );
  return EXIT.ok;
}

export function queueList(context: CommandContext, settings: LeaseSettings) {
  const snapshot = statusJson(settings, context.env, () => []);
  if (context.args.flags.has("json")) {
    const { version, schema, waiters } = snapshot;
    context.ui.data(`${JSON.stringify({ version, schema, waiters })}\n`);
    return EXIT.ok;
  }
  if (snapshot.waiters.length === 0) context.ui.data("queue: empty\n");
  context.ui.results.records(
    snapshot.waiters.map(
      (w) =>
        `${w.id} ${w.lane} position ${w.position} waited ${w.waited_s}s eta ${w.eta_s ?? "?"}s weight ${w.weight} pid ${w.pid} ${w.session ?? "-"} ${w.label}`,
    ),
  );
  return EXIT.ok;
}

export function queuePromote(
  context: CommandContext,
  settings: LeaseSettings,
  id: string | undefined,
): number {
  if (id === undefined) throw new ArgumentError("name the job id");
  if (!context.args.flags.has("now"))
    throw new ArgumentError(
      "promote starts a job at once: pass --now --reason <text>",
    );
  requireOperatorFor(context, "pmcp heavy promote --now");
  const paths = leasePaths(settings.dir);
  return report(
    context,
    promote(paths, id, who(context), reason(context, true)),
  );
}

export function queuePriority(
  context: CommandContext,
  settings: LeaseSettings,
  id: string | undefined,
  to: string | undefined,
): number {
  if (id === undefined || to === undefined)
    throw new ArgumentError(
      "pmcp heavy priority <id> <lane|+N|-N> --reason <text>",
    );
  const paths = leasePaths(settings.dir);
  return report(
    context,
    reprioritize(paths, id, to, who(context), reason(context, true)),
  );
}

// A waiting job is told to leave the queue; a running one is stopped only with --force.
export function queueCancel(
  context: CommandContext,
  settings: LeaseSettings,
  id: string | undefined,
): number {
  if (id === undefined) throw new ArgumentError("name the job id");
  const paths = leasePaths(settings.dir);
  const because = reason(context, false);
  const ticket =
    /^\d{10}-[0-9a-f]{6}$/u.test(id) && ticketExists(settings.dir, id);
  const waiting = cancelWaiter(paths, id, who(context), because);
  if (waiting.ok) {
    if (ticket)
      writeResult(settings.dir, id, {
        version: 1,
        ticket: id,
        exit: 130,
        outcome: "cancelled",
      });
    context.ui.data(`${id} cancelled\n`);
    return EXIT.ok;
  }
  const running = findRunning(paths, id);
  const force = context.args.flags.has("force");
  const owner =
    (ticket ? ticketOwner(settings.dir, id) : null) ?? running?.session;
  if (force && owner !== undefined && owner !== who(context).session)
    requireOperatorFor(
      context,
      `pmcp heavy cancel --force on another session's job (${owner})`,
    );
  if (running !== null && !ticket) {
    if (!force) {
      context.ui.error(`${id} is running; --force stops it`);
      return EXIT.failure;
    }
    process.kill(running.pid, "SIGTERM");
    context.ui.data(`${id} stopped\n`);
    return EXIT.ok;
  }
  if (!ticket) {
    context.ui.error(waiting.why);
    return EXIT.failure;
  }
  const done = cancelTicket(settings.dir, id, force);
  if (done === "running") {
    context.ui.error(`${id} is running; --force stops it`);
    return EXIT.failure;
  }
  context.ui.data(`${id} ${done}\n`);
  return done === "cancelled" ? EXIT.ok : EXIT.failure;
}
