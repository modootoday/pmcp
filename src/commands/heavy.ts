import { dirname } from "node:path";

import {
  ArgumentError,
  EXIT,
  one,
  type Command,
  type CommandContext,
} from "../cli/command.js";
import { ConfigError, findConfig } from "../config.js";
import {
  NOW_ENV,
  leaseSettingsFor,
  type LeaseSettings,
} from "../lease/config.js";
import { LANES, leasePaths, type LeaseLane } from "../lease/files.js";
import { DEFAULT_JOB_LOG_BYTES, JobLog } from "../lease/job-log.js";
import { sessionOf } from "../lease/queue.js";
import { runHeavy } from "../lease/run.js";
import { leaseStatus } from "../lease/status.js";
import { statusJson } from "../lease/status-json.js";
import {
  blockingTicket,
  jobLogPath,
  writeResult,
  type TicketResult,
} from "../lease/tickets.js";
import type { Usage } from "../lease/usage.js";
import {
  queueCancel,
  queueList,
  queuePriority,
  queuePromote,
} from "./heavy-queue.js";
import { submitTicket, ticketResult, ticketWait } from "./heavy-tickets.js";
import {
  readUsage,
  skipReasons,
  skipShare,
  usageStats,
  type UsageStat,
} from "../lease/usage.js";
import { isOperator, requireOperatorFor } from "../sessions/operator-cli.js";
import { heavySpec } from "./specs/host.js";

function settings(context: CommandContext): LeaseSettings {
  const ignored = (key: string) =>
    process.stderr.write(
      `pmcp heavy: ignoring unknown key [host.lease] ${key}; a newer pmcp may know it, other pmcp commands still refuse it\n`,
    );
  try {
    return leaseSettingsFor(context.cwd, one(context.args, "config"), ignored);
  } catch (error) {
    if (error instanceof ConfigError) throw new ArgumentError(error.message);
    throw error;
  }
}

function statLine(stat: UsageStat): string {
  const pair = (key: keyof UsageStat["p50"], scale = 1, unit = "") =>
    `${Math.round(stat.p50[key] / scale)}/${Math.round(stat.p90[key] / scale)}${unit}`;
  const cpu = {
    p50: stat.p50.user_s + stat.p50.sys_s,
    p90: stat.p90.user_s + stat.p90.sys_s,
  };
  return [
    stat.signature,
    `samples ${stat.samples} (failed ${stat.failed}, timeouts ${stat.timeouts}, skipped the lease ${stat.skipped})`,
    `wall ${pair("wall_s", 1, "s")}`,
    `cpu ${Math.round(cpu.p50)}/${Math.round(cpu.p90)}s`,
    `rss ${pair("max_rss_kb", 1024, "MB")}`,
    `read ${pair("read_bytes", 1e6, "MB")}`,
    `write ${pair("write_bytes", 1e6, "MB")}`,
  ].join("  ");
}

function top(context: CommandContext): number | undefined {
  const text = one(context.args, "top");
  if (text === undefined) return undefined;
  const count = Number(text);
  if (!Number.isInteger(count) || count < 1)
    throw new ArgumentError("--top is a whole number of at least 1");
  return count;
}

function stats(context: CommandContext): number {
  const records = readUsage(leasePaths(settings(context).dir).usage);
  const limit = top(context);
  const found = usageStats(records).slice(0, limit);
  if (context.args.flags.has("json")) {
    context.ui.data(`${JSON.stringify(found)}\n`);
    return EXIT.ok;
  }
  const lines: string[] = [];
  if (found.length === 0) lines.push("no usage recorded yet");
  const { skipped, runs } = skipShare(records);
  if (runs > 0)
    lines.push(
      `skipped the lease: ${skipped} of ${runs} runs (${Math.round((skipped / runs) * 100)}%)`,
    );
  const reasons = skipReasons(records);
  const counted = (counts: Readonly<Record<string, number>>) =>
    Object.entries(counts)
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
      .map(([name, count]) => `${name} ${count}`)
      .join(", ");
  if (Object.keys(reasons.honoured).length > 0)
    lines.push(`skip reasons: ${counted(reasons.honoured)}`);
  if (Object.keys(reasons.invalid).length > 0)
    lines.push(`refused skip reasons: ${counted(reasons.invalid)}`);
  lines.push(
    "signature @ dir  samples  p50/p90 of wall, cpu, rss, read, write",
  );
  lines.push(...found.map(statLine));
  context.ui.results.records(lines);
  return EXIT.ok;
}

// Words before --: the verb and its ticket, never part of the command to run.
function verbs(context: CommandContext): string[] {
  const { positional, passthrough } = context.args;
  return positional.slice(0, positional.length - (passthrough?.length ?? 0));
}

function subcommand(context: CommandContext): number | Promise<number> {
  const [verb, ticket, to, ...rest] = verbs(context);
  const lease = settings(context);
  if (verb === "priority" && rest.length === 0)
    return queuePriority(context, lease, ticket, to);
  if (to !== undefined) throw new ArgumentError(`unexpected ${to}`);
  if (verb === "result") return ticketResult(context, lease, ticket);
  if (verb === "wait") return ticketWait(context, lease, ticket);
  if (verb === "cancel") return queueCancel(context, lease, ticket);
  if (verb === "promote") return queuePromote(context, lease, ticket);
  if (ticket !== undefined && verb !== "queue")
    throw new ArgumentError(`unexpected ${ticket}`);
  if (verb === "queue") return queueList(context, lease);
  if (verb !== "status" && verb !== "stats")
    throw new ArgumentError(
      "put the command after --, or use pmcp heavy status | stats | queue | submit | wait | result | promote | priority | cancel",
    );
  if (verb === "stats") return stats(context);
  if (context.args.flags.has("json")) {
    const snapshot = statusJson(lease, context.env);
    context.ui.data(`${JSON.stringify(snapshot)}\n`);
    return EXIT.ok;
  }
  context.ui.results.records(
    leaseStatus({ settings: lease, env: context.env }),
  );
  return EXIT.ok;
}

async function run(context: CommandContext): Promise<number> {
  const { args } = context;
  const say = (line: string) => process.stderr.write(`pmcp heavy: ${line}\n`);
  const [verb, ...extra] = verbs(context);
  if (args.passthrough === undefined || verb !== undefined) {
    if (verb !== "submit") return subcommand(context);
    if (extra.length > 0) throw new ArgumentError(`unexpected ${extra[0]}`);
  }
  if (args.passthrough === undefined || args.passthrough.length === 0)
    throw new ArgumentError("no command after --");
  const lease = settings(context);
  const profile = one(args, "profile") ?? "default";
  if (lease.profiles[profile] === undefined)
    throw new ArgumentError(
      `unknown profile ${profile}; known: ${Object.keys(lease.profiles).join(", ")}`,
    );
  const label = one(args, "label");
  const reason = one(args, "reason") ?? context.env[NOW_ENV];
  const now = args.flags.has("now") || Boolean(context.env[NOW_ENV]);
  if (now && !reason?.trim())
    throw new ArgumentError(
      "--now needs --reason <text>: say why it cannot wait",
    );
  if (!now && one(args, "reason") !== undefined)
    throw new ArgumentError("--reason goes with --now");
  const lane = one(args, "lane");
  if (lane !== undefined && !LANES.includes(lane as LeaseLane))
    throw new ArgumentError(`--lane is ${LANES.join(", ")}`);
  const weightText = one(args, "weight");
  const weight = weightText === undefined ? undefined : Number(weightText);
  if (weight !== undefined && !(Number.isInteger(weight) && weight >= 0))
    throw new ArgumentError("--weight is a whole number (0 for a tiny job)");
  if (verb === "submit") {
    if (now) throw new ArgumentError("--now runs at once; it is not submitted");
    return submitTicket(context, lease, args.passthrough);
  }
  if (now) requireOperatorFor(context, "pmcp heavy --now");
  const submitted = one(args, "ticket");
  const kept = keepOutput(context, lease, label, submitted);
  const ticket = submitted ?? kept?.id;
  let result: TicketResult | null = null;
  const config = one(args, "config") ?? findConfig(context.cwd);
  const code = await runHeavy({
    settings: lease,
    profile,
    ...(label ? { label } : {}),
    ...(lane ? { lane: lane as LeaseLane } : {}),
    ...(weight !== undefined ? { weight } : {}),
    ...(now ? { now: reason! } : {}),
    root: config ? dirname(config) : context.cwd,
    operator: () => isOperator(context),
    ...(ticket ? { id: ticket } : {}),
    argv: args.passthrough,
    cwd: context.cwd,
    env: context.env,
    say: (line: string) => {
      say(line);
      kept?.log.write(`pmcp heavy: ${line}\n`);
    },
    ...(kept ? { output: kept.log, echo: submitted === undefined } : {}),
    ...(ticket
      ? {
          onUsage: (usage: Usage) => {
            result = { version: 1, ticket, ...usage };
          },
        }
      : {}),
  });
  kept?.log.close();
  if (ticket)
    writeResult(
      lease.dir,
      ticket,
      result ?? { version: 1, ticket, exit: code, outcome: "ran" },
      true,
    );
  if (kept && submitted === undefined && code !== 0)
    say(`output kept: pmcp heavy result ${kept.id} --log`);
  return code;
}

// A submitted job's runner keeps its output in the ticket; a blocking run opens a ticket for
// it unless job_log_bytes is 0. Keeping a copy never stops the run.
function keepOutput(
  context: CommandContext,
  lease: LeaseSettings,
  label: string | undefined,
  submitted: string | undefined,
): { id: string; log: JobLog } | null {
  const cap = lease.jobLogBytes ?? DEFAULT_JOB_LOG_BYTES;
  try {
    if (submitted !== undefined)
      return {
        id: submitted,
        log: new JobLog(
          jobLogPath(lease.dir, submitted),
          cap || DEFAULT_JOB_LOG_BYTES,
        ),
      };
    // A disabled lease is a plain pass-through that writes nothing to its directory.
    if (cap === 0 || !lease.enabled) return null;
    const id = blockingTicket({
      dir: lease.dir,
      label: label ?? context.args.passthrough!.join(" "),
      cwd: context.cwd,
      session: sessionOf(context.env, context.cwd),
    });
    return { id, log: new JobLog(jobLogPath(lease.dir, id), cap) };
  } catch {
    return null;
  }
}

export const heavyCommand: Command = { ...heavySpec, run };
