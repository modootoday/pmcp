import type { CommandSpec } from "../../cli/command.js";
import { nearestConfigOption } from "../options/inspection.js";

export const heavySpec: CommandSpec = {
  name: "heavy",
  describe:
    "Run a heavy command under the host-wide lease, one at a time, after the host settles",
  usage:
    "pmcp heavy [--label <text>] [--profile default|gate|<name>] -- <command...> | pmcp heavy status",
  options: [
    nearestConfigOption,
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
  ],
};
