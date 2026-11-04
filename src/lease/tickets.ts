import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { leasePaths, liveRecords, pidAlive } from "./files.js";
import type { Usage } from "./usage.js";

// A submitted job: pmcp heavy submit returns a ticket at once and a detached runner (its own
// session, so it outlives the caller) queues and runs the command under the same rules.
// tickets/<id>/ holds the request, the runner's pid, the output log and, once done, result.json.

export function ticketExists(dir: string, id: string): boolean {
  try {
    return readJson(join(ticketDir(dir, id), "request.json")) !== null;
  } catch {
    return false;
  }
}

export type TicketState = "queued" | "running" | "done" | "lost";

export interface TicketResult extends Partial<Usage> {
  readonly version: 1;
  readonly ticket: string;
  readonly exit: number;
  readonly outcome: "ran" | "timeout" | "cancelled";
}

export interface TicketView {
  readonly id: string;
  readonly state: TicketState;
  readonly label: string;
  readonly pid: number | null;
  readonly position: number | null;
  readonly result: TicketResult | null;
}

const ID = /^\d{10}-[0-9a-f]{6}$/u;
const KEEP_MS = 7 * 86_400_000;

export function ticketsDir(dir: string): string {
  return join(dir, "tickets");
}

export function ticketDir(dir: string, id: string): string {
  if (!ID.test(id)) throw new Error(`not a ticket id: ${id}`);
  return join(ticketsDir(dir), id);
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  const temporary = `${file}.tmp.${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`);
  renameSync(temporary, file);
}

// The runner keeps a cancel's result: a cancelled job's exit is not its own.
export function writeResult(
  dir: string,
  id: string,
  result: TicketResult,
  keepExisting = false,
) {
  const file = join(ticketDir(dir, id), "result.json");
  if (keepExisting && readJson<TicketResult>(file) !== null) return;
  writeJson(file, result);
}

// Done tickets older than a week go, so the directory stays small.
function prune(dir: string): void {
  let names: string[] = [];
  try {
    names = readdirSync(ticketsDir(dir));
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(ticketsDir(dir), name);
    try {
      const done = statSync(join(path, "result.json"));
      if (Date.now() - done.mtimeMs > KEEP_MS)
        rmSync(path, { recursive: true, force: true });
    } catch {
      // Not done yet.
    }
  }
}

export interface Submit {
  readonly dir: string;
  readonly label: string;
  // The runner's own command line: this pmcp, heavy, the caller's options and --ticket.
  readonly runner: (ticket: string) => readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export function submit(request: Submit): string {
  prune(request.dir);
  const id = `${Math.floor(Date.now() / 1000)}-${randomBytes(3).toString("hex")}`;
  const path = ticketDir(request.dir, id);
  mkdirSync(path, { recursive: true });
  writeJson(join(path, "request.json"), {
    version: 1,
    ticket: id,
    label: request.label,
    cwd: request.cwd,
    created: new Date().toISOString(),
  });
  const log = openSync(join(path, "log"), "a");
  const [bin, ...args] = request.runner(id);
  const child = spawn(bin!, args, {
    cwd: request.cwd,
    env: request.env,
    detached: true,
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  writeFileSync(join(path, "pid"), `${child.pid}\n`);
  child.unref();
  return id;
}

export function ticketView(dir: string, id: string): TicketView | null {
  const path = ticketDir(dir, id);
  const request = readJson<{ label: string }>(join(path, "request.json"));
  if (request === null) return null;
  const result = readJson<TicketResult>(join(path, "result.json"));
  const pidText = readJson<number>(join(path, "pid"));
  const pid = typeof pidText === "number" && pidText > 0 ? pidText : null;
  const base = { id, label: request.label, pid, result };
  if (result) return { ...base, state: "done", position: null };
  // The pid file follows the spawn by a moment; until then the ticket is queued.
  if (pid === null) return { ...base, state: "queued", position: null };
  if (!pidAlive(pid)) return { ...base, state: "lost", position: null };
  const paths = leasePaths(dir);
  const waiting = liveRecords(paths.waiters, false).findIndex(
    (r) => r.pid === pid,
  );
  if (waiting >= 0) return { ...base, state: "queued", position: waiting + 1 };
  const running = liveRecords(paths.running, false).some((r) => r.pid === pid);
  return { ...base, state: running ? "running" : "queued", position: null };
}

// Tickets not done, and those done in the last hour, for status.
export function recentTickets(dir: string): TicketView[] {
  let names: string[] = [];
  try {
    names = readdirSync(ticketsDir(dir)).filter((name) => ID.test(name));
  } catch {
    return [];
  }
  return names
    .sort()
    .map((name) => ticketView(dir, name))
    .filter((view): view is TicketView => {
      if (view === null) return false;
      if (view.state !== "done") return true;
      try {
        const done = statSync(join(ticketDir(dir, view.id), "result.json"));
        return Date.now() - done.mtimeMs < 3_600_000;
      } catch {
        return false;
      }
    });
}

export function logTail(dir: string, id: string, lines = 20): string {
  try {
    const text = readFileSync(join(ticketDir(dir, id), "log"), "utf8");
    return text
      .split("\n")
      .slice(-lines - 1)
      .join("\n");
  } catch {
    return "";
  }
}

export type Cancelled = "cancelled" | "running" | "done" | "unknown";

// A queued job is stopped; a running one only with force, by its whole process group.
export function cancel(dir: string, id: string, force: boolean): Cancelled {
  const view = ticketView(dir, id);
  if (view === null) return "unknown";
  if (view.state === "done") return "done";
  if (view.state === "running" && !force) return "running";
  if (view.pid !== null && pidAlive(view.pid)) {
    try {
      process.kill(-view.pid, "SIGTERM");
    } catch {
      process.kill(view.pid, "SIGTERM");
    }
  }
  writeResult(dir, id, {
    version: 1,
    ticket: id,
    exit: 130,
    outcome: "cancelled",
  });
  return "cancelled";
}
