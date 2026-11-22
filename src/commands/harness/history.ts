import { ArgumentError, type CommandContext } from "../../cli/command.js";
import { ContinuityJournal } from "../../harness/continuity/journal.js";
import { archiveContinuityHistory } from "../../harness/continuity/history-archive.js";
import { openContinuityHistory } from "../../harness/continuity/open-history.js";
import { runtimeIdOf } from "../../runtime/ids.js";
import {
  HISTORY_RUNTIMES,
  importContinuityHistory,
} from "../../harness/continuity/import-history.js";

export async function runHistory(context: CommandContext): Promise<number> {
  if (context.args.positional[1] === "wake-open") {
    const [, , archive, socket, model, ...extra] = context.args.positional;
    if (!archive || !socket || extra.length) {
      throw new ArgumentError(
        "Usage: pmcp harness history wake-open <archive> <socket> [model]",
      );
    }
    const { openWakeableCodex } =
      await import("../../harness/continuity/open-wakeable.js");
    return openWakeableCodex(archive, socket, model);
  }
  if (context.args.positional[1] === "open") {
    const [, , runtimeName, archive, ...extra] = context.args.positional;
    const runtime = HISTORY_RUNTIMES.find(
      (entry) => entry === runtimeIdOf(runtimeName ?? ""),
    );
    if (!runtime || !archive || extra.length) {
      throw new ArgumentError(
        "Usage: pmcp harness history open <runtime> <archive>",
      );
    }
    return openContinuityHistory(runtime, archive);
  }
  if (context.args.positional[1] === "archive") {
    const [, , runtimeName, sessionId, source, archive, worktree, ...extra] =
      context.args.positional;
    const runtime = HISTORY_RUNTIMES.find(
      (entry) => entry === runtimeIdOf(runtimeName ?? ""),
    );
    if (
      !runtime ||
      !sessionId ||
      !source ||
      !archive ||
      !worktree ||
      extra.length
    ) {
      throw new ArgumentError(
        "Usage: pmcp harness history archive <runtime> <session-id> <source> <archive> <worktree>",
      );
    }
    const result = await archiveContinuityHistory({
      runtime,
      sessionId,
      source,
      archive,
      worktree,
    });
    context.ui.data(
      `${JSON.stringify({ ok: true, sessionId, archive, ...result })}\n`,
    );
    return 0;
  }
  const [, verb, runtimeName, source, database, worktreePath, ...extra] =
    context.args.positional;
  const normalized = runtimeIdOf(runtimeName ?? "");
  const runtime = HISTORY_RUNTIMES.find((entry) => entry === normalized);
  if (
    verb !== "import" ||
    !runtime ||
    !source ||
    !database ||
    !worktreePath ||
    extra.length
  ) {
    throw new ArgumentError(
      `Usage: pmcp harness history import <${HISTORY_RUNTIMES.join("|")}> <source> <database> <worktree>`,
    );
  }
  const journal = await ContinuityJournal.open(database);
  try {
    const result = await importContinuityHistory(journal, {
      runtime,
      source,
      worktreePath,
    });
    context.ui.data(`${JSON.stringify({ ok: true, ...result })}\n`);
    return 0;
  } finally {
    journal.close();
  }
}
