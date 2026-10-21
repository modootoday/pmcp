import type { CommandContext } from "../cli/command.js";
import type { RemoteEntry } from "../remote/catalog.js";

// Share standing text so advisory and verification claims cannot diverge between commands.
export function sayStanding(
  context: CommandContext,
  line: RemoteEntry["line"],
): void {
  if (!line) return;

  if (line.status === "recalled" && line.recall) {
    // Name the affected version range so a refusal does not blame the whole package.
    context.ui.warn(
      "recalled",
      `${line.recall.severity} advisory against the versions this line covers`,
    );
    context.ui.line(`    ${line.recall.summary}`);
    context.ui.line(`    ${line.recall.advisoryUrl}`);
    context.ui.line(
      line.recall.reverifyAt
        ? `    the fix is in ${line.recall.reverifyAt}; move there and this skill still applies`
        : "    no release in this line is unaffected; move to a newer major",
    );
    return;
  }

  if (line.status === "frozen") {
    context.ui.line(
      `    written for ${String(line.major)}.x, which is no longer revised; the date above is where it stopped`,
    );
  }
}
