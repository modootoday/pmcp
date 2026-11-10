import type { CommandSpec } from "../../cli/command.js";
import { jsonOption, nearestConfigOption } from "../options/inspection.js";

export const heavySpec: CommandSpec = {
  name: "heavy",
  examples: [
    "pmcp heavy -- npm test",
    'pmcp heavy --label "web build" --profile gate -- npm run build',
  ],
  subcommands: [
    {
      name: "submit",
      describe: "Queue a command and return its ticket at once",
      usage:
        "pmcp heavy submit [--label <text>] [--lane <lane>] [--weight <n>] -- <command...>",
      options: ["label", "profile", "lane", "weight", "config", "json"],
      examples: ["pmcp heavy submit --lane bulk -- npm run build"],
    },
    {
      name: "wait",
      describe: "Wait for a submitted ticket to finish",
      usage: "pmcp heavy wait <ticket> [--timeout <s>]",
      options: ["timeout", "config", "json"],
      examples: ["pmcp heavy wait 7f3a --timeout 900"],
    },
    {
      name: "result",
      describe: "A job's state and exit code, or with --log its kept output",
      usage: "pmcp heavy result <id> [--log [--tail <n>]] [--json]",
      options: ["log", "tail", "config", "json"],
      examples: [
        "pmcp heavy result 1794239701-482b9b",
        "pmcp heavy result 1794239701-482b9b --log --tail 50",
      ],
    },
    {
      name: "queue",
      describe: "The queued and running jobs by lane",
      usage: "pmcp heavy queue [--json]",
      options: ["config", "json"],
      examples: ["pmcp heavy queue --json"],
    },
    {
      name: "promote",
      describe: "Run a queued job now (emergency; logged)",
      usage: "pmcp heavy promote <id> --now --reason <text>",
      options: ["now", "reason", "config"],
      examples: ['pmcp heavy promote 7f3a --now --reason "release blocker"'],
    },
    {
      name: "priority",
      describe: "Move a queued job to another lane or position",
      usage: "pmcp heavy priority <id> <lane|+N|-N> --reason <text>",
      options: ["reason", "config"],
      examples: ['pmcp heavy priority 7f3a gate --reason "blocks the land"'],
    },
    {
      name: "cancel",
      describe: "Withdraw a queued job; --force also stops a running one",
      usage: "pmcp heavy cancel <id> [--force]",
      options: ["force", "reason", "config"],
      examples: ["pmcp heavy cancel 7f3a"],
    },
    {
      name: "status",
      describe: "The lease, its holder, waiters and the host readings",
      usage: "pmcp heavy status [--json]",
      options: ["config", "json"],
      examples: ["pmcp heavy status --json"],
    },
    {
      name: "stats",
      describe: "Recorded run times and weights per command",
      usage: "pmcp heavy stats [--top <n>] [--json]",
      options: ["top", "config", "json"],
      examples: ["pmcp heavy stats --top 10"],
    },
  ],
  describe:
    "Run a heavy command within the host-wide budget, by lane, once the host has room",
  usage:
    "pmcp heavy [--label <text>] [--profile <name>] [--lane <lane>] [--weight <n>] [--now --reason <text>] -- <command...> | pmcp heavy <subcommand> [options]",
  options: [
    nearestConfigOption,
    jsonOption,
    {
      name: "label",
      describe: "What status and the log call this job (default: the command).",
      placeholder: "<text>",
    },
    {
      name: "profile",
      describe:
        "Wait limits from [host.lease.profiles.<name>] (default: default).",
      placeholder: "<name>",
    },
    {
      name: "now",
      describe:
        "Emergency: run at once, outside the lanes, the budget and the host check, still counted in the running weight; needs --reason.",
      boolean: true,
    },
    {
      name: "reason",
      describe:
        "Why: a --now run or a promote cannot wait, a priority change or cancel was needed; logged.",
      placeholder: "<text>",
    },
    {
      name: "timeout",
      describe: "wait: give up after this many seconds and exit 75.",
      placeholder: "<s>",
    },
    {
      name: "force",
      describe: "cancel: also stop a job that is already running.",
      boolean: true,
    },
    {
      name: "top",
      describe: "stats: only the n commands with the most runs.",
      placeholder: "<n>",
    },
    {
      name: "log",
      describe:
        "result: print the job's kept stdout and stderr instead of its state.",
      boolean: true,
    },
    {
      name: "tail",
      describe: "result --log: only the last n lines.",
      placeholder: "<n>",
    },
    {
      name: "ticket",
      describe: "Internal: the submitted ticket this run belongs to.",
      placeholder: "<id>",
    },
    {
      name: "lane",
      describe:
        "Queue in this lane: gate, hook, interactive or bulk; a short budget goes to them in that order (default: from the profile, [host.lease] commands, else interactive).",
      placeholder: "<lane>",
    },
    {
      name: "weight",
      describe:
        "How much of the host budget the command takes (default: [host.lease] commands, else the lane's weight).",
      placeholder: "<n>",
    },
  ],
};

export const hostSpec: CommandSpec = {
  name: "host",
  examples: [
    "pmcp host io measure",
    "pmcp host io plan",
    "pmcp host io doctor --weights",
  ],
  subcommands: [
    {
      name: "io measure",
      describe:
        "Probe the disk under the host lease and record its io.cost model",
      usage: "pmcp host io measure [--dir <path>] [--seconds <n>] [--json]",
      options: ["dir", "seconds", "config", "json"],
      examples: ["pmcp host io measure --dir /var/tmp"],
    },
    {
      name: "io plan",
      describe: "Print the io.cost lines and a systemd unit to install as root",
      usage: "pmcp host io plan [--unit <name>] [--json]",
      options: ["unit", "config", "json"],
      examples: ["pmcp host io plan --unit iocost.service"],
    },
    {
      name: "io doctor",
      describe: "Compare the live io.cost model and qos with the record",
      usage: "pmcp host io doctor [--weights [--seconds <n>]] [--json]",
      options: ["weights", "seconds", "config", "json"],
      examples: ["pmcp host io doctor", "pmcp host io doctor --weights"],
    },
  ],
  describe:
    "Measure the disk and check the io.cost model the lease's io weights rely on",
  usage: "pmcp host io <measure|plan|doctor> [options]",
  options: [
    nearestConfigOption,
    jsonOption,
    {
      name: "dir",
      describe:
        "measure: make the probe file on this directory's filesystem (default: the lease directory).",
      placeholder: "<path>",
    },
    {
      name: "seconds",
      describe:
        "measure: seconds per probe pattern (default 8); doctor --weights: seconds the readers run (default 20).",
      placeholder: "<n>",
    },
    {
      name: "unit",
      describe:
        "plan: print a drop-in for this oneshot unit instead of a unit of its own.",
      placeholder: "<name>",
    },
    {
      name: "weights",
      describe:
        "doctor: also run two readers at io.weight 25 and 100 under the host lease and compare them.",
      boolean: true,
    },
    {
      name: "probe",
      describe: "Internal: the probe job a leased run executes.",
      placeholder: "<job>",
    },
  ],
};
