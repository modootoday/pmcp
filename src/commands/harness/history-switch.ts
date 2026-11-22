import { ArgumentError, type CommandContext } from "../../cli/command.js";
import { headlessContinuityAdapter } from "../../harness/continuity/headless.js";
import { HISTORY_RUNTIMES } from "../../harness/continuity/import-history.js";
import { ContinuityJournal } from "../../harness/continuity/journal.js";
import { startContinuitySwitch } from "../../harness/continuity/switch.js";
import { runtimeIdOf } from "../../runtime/ids.js";

const CONTEXT_BYTES = 24 * 1024;

export async function runHistorySwitch(
  context: CommandContext,
): Promise<number> {
  const [, operation, database, sessionId, ...args] = context.args.positional;
  if (!database || !sessionId) {
    throw new ArgumentError("Missing continuity database or PMCP session ID");
  }
  const journal = await ContinuityJournal.open(database);
  try {
    const entry = journal.read(sessionId);
    if (!entry) throw new ArgumentError("Unknown PMCP session ID");
    const { checkpoint, pending } = entry;
    if (operation === "status") {
      if (args.length)
        throw new ArgumentError("Unexpected history status arguments");
      const { events, ...metadata } = checkpoint;
      context.ui.data(
        JSON.stringify({ ...metadata, eventCount: events.length, pending }) +
          "\n",
      );
      return 0;
    }
    if (operation === "cancel-switch") {
      const [attempt, confirmation, ...extra] = args;
      if (
        !attempt ||
        confirmation !== "confirmed-not-started" ||
        extra.length
      ) {
        throw new ArgumentError(
          "Usage: pmcp harness history cancel-switch <database> <pmcp-session-id> <attempt-id> confirmed-not-started",
        );
      }
      const next = journal.settle(sessionId, attempt, null);
      context.ui.data(
        JSON.stringify({
          sessionId,
          revision: next.revision,
          archive: next.lastArchive,
          activeRuntime: next.activeRuntime,
        }) + "\n",
      );
      return 0;
    }
    if (pending) throw new Error("continuity_switch_pending");
    const [target, prompt, ...extra] = args;
    const runtime = HISTORY_RUNTIMES.find(
      (id) => id === runtimeIdOf(target ?? ""),
    );
    if (!runtime || !prompt?.trim() || extra.length) {
      throw new ArgumentError(
        "Usage: pmcp harness history switch <database> <pmcp-session-id> <runtime> <prompt>",
      );
    }
    const selected = new Set<number>();
    let remaining = CONTEXT_BYTES;
    for (let index = checkpoint.events.length - 1; index >= 0; index--) {
      const event = checkpoint.events[index]!;
      const size = Buffer.byteLength(JSON.stringify(event));
      if (size > remaining) continue;
      selected.add(event.sequence);
      remaining -= size;
    }
    const next = await startContinuitySwitch(
      journal,
      checkpoint,
      headlessContinuityAdapter(runtime, prompt),
      selected,
      AbortSignal.timeout(125_000),
    );
    context.ui.data(
      JSON.stringify({
        sessionId,
        activeRuntime: next.activeRuntime,
        revision: next.revision,
        archive: next.lastArchive,
        response: next.events.at(-1),
      }) + "\n",
    );
    return 0;
  } finally {
    journal.close();
  }
}
