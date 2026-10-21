import { ArgumentError, EXIT, type Command } from "../cli/command.js";
import { completionScript, SHELLS, type Shell } from "./completion/scripts.js";
import { COMMANDS } from "./registry.js";
import { completionSpec } from "./specs/completion.js";

function isShell(value: string | undefined): value is Shell {
  return (SHELLS as readonly (string | undefined)[]).includes(value);
}

export const completionCommand: Command = {
  ...completionSpec,
  run(context) {
    const [shell, ...extra] = context.args.positional;
    if (!isShell(shell) || extra.length > 0) {
      throw new ArgumentError(`choose one shell: ${SHELLS.join(", ")}`);
    }
    context.ui.data(completionScript(shell, COMMANDS));
    return EXIT.ok;
  },
};
