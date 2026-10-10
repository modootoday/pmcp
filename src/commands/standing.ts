import type { CommandContext } from "../cli/command.js";
import type { RemoteEntry } from "../remote/catalog.js";

/**
 * Saying where a line stands, in one place.
 *
 * A verification date that stops moving is honest only while it is said to
 * have stopped, and a line an advisory has reached must not be offered as
 * though it were the one to install. Both commands that show a skill say this,
 * and two copies of the wording is two things to keep true.
 */
export function sayStanding(
  context: CommandContext,
  line: RemoteEntry["line"],
): void {
  if (!line) return;

  if (line.status === "recalled" && line.recall) {
    // The loudest thing this surface says. The skill is usually not at fault:
    // what is unsafe is the range it was written for.
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
