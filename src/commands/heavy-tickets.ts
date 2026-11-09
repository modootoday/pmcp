import {
  ArgumentError,
  EXIT,
  one,
  type CommandContext,
} from "../cli/command.js";
import { BUSY_EXIT, type LeaseSettings } from "../lease/config.js";
import { sessionOf } from "../lease/queue.js";
import {
  logTail,
  submit,
  ticketView,
  type TicketView,
} from "../lease/tickets.js";

// submit, wait, result and cancel: the caller keeps working while its job queues.

const PASSED = ["config", "label", "profile", "lane", "weight"] as const;

export function submitTicket(
  context: CommandContext,
  settings: LeaseSettings,
  command: readonly string[],
): number {
  const flags = PASSED.flatMap((name) => {
    const value = one(context.args, name);
    return value === undefined ? [] : [`--${name}`, value];
  });
  const self = [process.execPath, ...process.execArgv, process.argv[1] ?? ""];
  const id = submit({
    dir: settings.dir,
    label: one(context.args, "label") ?? command.join(" "),
    runner: (ticket) => [
      ...self,
      "heavy",
      ...flags,
      "--ticket",
      ticket,
      "--",
      ...command,
    ],
    cwd: context.cwd,
    env: context.env,
    session: sessionOf(context.env, context.cwd),
  });
  context.ui.data(`${id}\n`);
  return EXIT.ok;
}

function describe(view: TicketView): string {
  const where = view.position === null ? "" : ` position ${view.position}`;
  const result = view.result
    ? ` exit ${view.result.exit} (${view.result.outcome})`
    : "";
  return `${view.id} ${view.state}${where}${result} ${view.label}`;
}

function viewOf(settings: LeaseSettings, id: string | undefined): TicketView {
  if (id === undefined) throw new ArgumentError("name the ticket");
  let view: TicketView | null;
  try {
    view = ticketView(settings.dir, id);
  } catch (error) {
    throw new ArgumentError((error as Error).message);
  }
  if (view === null) throw new ArgumentError(`no ticket ${id}`);
  return view;
}

export function ticketResult(
  context: CommandContext,
  settings: LeaseSettings,
  id: string | undefined,
): number {
  const view = viewOf(settings, id);
  if (context.args.flags.has("json"))
    context.ui.data(`${JSON.stringify({ version: 1, ...view })}\n`);
  else context.ui.data(`${describe(view)}\n`);
  return EXIT.ok;
}

export async function ticketWait(
  context: CommandContext,
  settings: LeaseSettings,
  id: string | undefined,
): Promise<number> {
  const text = one(context.args, "timeout");
  const timeout = text === undefined ? Infinity : Number(text);
  if (!(timeout > 0)) throw new ArgumentError("--timeout must be positive");
  const deadline = Date.now() + timeout * 1000;
  let view = viewOf(settings, id);
  while (view.state === "queued" || view.state === "running") {
    if (Date.now() >= deadline) {
      context.ui.error(`${view.id} is still ${view.state}`);
      return BUSY_EXIT;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    view = viewOf(settings, view.id);
  }
  const tail = logTail(settings.dir, view.id);
  if (tail.trim()) process.stderr.write(`${tail}\n`);
  context.ui.data(`${describe(view)}\n`);
  if (view.state === "lost") return EXIT.failure;
  return view.result?.exit ?? EXIT.failure;
}
