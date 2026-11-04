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
      describe: "The exit code and log of a finished ticket",
      usage: "pmcp heavy result <ticket>",
      options: ["config", "json"],
      examples: ["pmcp heavy result 7f3a"],
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
      usage: "pmcp heavy stats [--json]",
      options: ["config", "json"],
      examples: ["pmcp heavy stats"],
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
