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
      name: "status",
      describe: "The lease, its holder, waiters and the host readings",
      usage: "pmcp heavy status",
      options: ["config"],
      examples: ["pmcp heavy status"],
    },
  ],
  describe:
    "Run a heavy command within the host-wide budget, by lane, once the host has room",
  usage:
    "pmcp heavy [--label <text>] [--profile default|gate|hook|<name>] [--lane gate|hook|interactive|bulk] [--weight <n>] [--now --reason <text>] -- <command...> | pmcp heavy submit [options] -- <command...> | pmcp heavy wait|result <ticket> | pmcp heavy queue [--json] | pmcp heavy promote <id> --now --reason <text> | pmcp heavy priority <id> <lane|+N|-N> --reason <text> | pmcp heavy cancel <id> [--force] | pmcp heavy status [--json] | pmcp heavy stats [--json]",
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
