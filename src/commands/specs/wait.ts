import type { CommandSpec } from "../../cli/command.js";

export const waitSpec: CommandSpec = {
  name: "wait",
  examples: [
    "pmcp wait --pid 4242",
    "pmcp wait --until gone:/tmp/build.lock --until load-below:6 --timeout 900",
  ],
  describe:
    "Sleep until a process exits or a condition holds, never matching itself",
  usage:
    "pmcp wait --pid <pid>... | --until <exists:<path>|gone:<path>|load-below:<n>|no-process:<text>>... [--timeout <s>] [--interval <s>]",
  options: [
    {
      name: "pid",
      describe: "Wait until this process has exited; repeatable.",
      placeholder: "<pid>",
      repeat: true,
    },
    {
      name: "until",
      describe:
        "Wait until this holds: exists:<path>, gone:<path>, load-below:<n>, no-process:<text>; repeatable, all must hold.",
      placeholder: "<condition>",
      repeat: true,
    },
    {
      name: "timeout",
      describe: "Give up after this many seconds and exit 75 (default 3600).",
      placeholder: "<s>",
    },
    {
      name: "interval",
      describe: "Seconds between checks (default 5).",
      placeholder: "<s>",
    },
  ],
};
