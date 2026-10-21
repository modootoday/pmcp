import type { CommandContext } from "../cli/command.js";
import type { readStatus } from "./read.js";

export function renderStatus(
  context: CommandContext,
  report: Awaited<ReturnType<typeof readStatus>>,
): void {
  context.ui.line("pmcp status: " + report.config);
  const enabled = report.features.filter((row) => row.enabled);
  context.ui.line(
    "Features: " +
      (enabled.map((row) => row.feature + " [" + row.source + "]").join(", ") ||
        "none"),
  );
  context.ui.line(
    "Projection: " +
      (report.projection.drift
        ? report.projection.problems.length + " drift(s)"
        : "matches") +
      " (" +
      report.projection.outputs +
      " outputs)",
  );
  for (const problem of report.projection.problems.slice(0, 3))
    context.ui.line("  " + problem);
  const state = report.sessions;
  context.ui.line(
    "Sessions: " +
      state.live.length +
      " live; pause " +
      (state.pause?.reason ?? "none") +
      "; " +
      state.leases.length +
      " lease(s); " +
      state.broadcasts.filter((row) => row.unseenBy.length > 0).length +
      " unseen broadcast(s)",
  );
  const drifted = report.worktrees.filter(
    (row) => (row.behind ?? 0) > 0 || (row.ahead ?? 0) > 0,
  );
  context.ui.line(
    "Desks: " +
      report.worktrees.length +
      "; " +
      drifted.length +
      " ahead/behind",
  );
  context.ui.line(
    "MCP auth: " +
      (report.mcp
        .map((row) => row.name + "=" + (row.present ? "present" : "absent"))
        .join(", ") || "no pmcp-auth servers"),
  );
  context.ui.line("Errors (last hour): " + report.errors.length);
}
