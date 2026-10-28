import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArgumentError, one, type CommandContext } from "../../cli/command.js";
import {
  NEUTRAL_EVENTS,
  RUNTIME_IDS,
  type NeutralEvent,
  type RuntimeId,
} from "../../hooks/contract.js";
import { RUNTIMES } from "../../hooks/runtimes/index.js";
import { seedState } from "./state.js";
import { simulate } from "../../hooks/inspection/simulate.js";
import { createFilesStore } from "../../sessions/files-store.js";
import { specFrom } from "../project/spec-from.js";

export async function run(context: CommandContext): Promise<number> {
  const fixtures = one(context.args, "fixtures");
  if (fixtures !== undefined)
    return (await import("./smoke.js")).run(context, fixtures);
  const runtime = one(context.args, "runtime");
  if (!(RUNTIME_IDS as readonly (string | undefined)[]).includes(runtime))
    throw new ArgumentError("--runtime must be claude or codex");
  const requested = one(context.args, "event");
  if (!requested) throw new ArgumentError("--event is required");
  const adapter = RUNTIMES[runtime as RuntimeId];
  const event = (NEUTRAL_EVENTS as readonly string[]).includes(requested)
    ? adapter.nativeEvent(requested as NeutralEvent)
    : requested;
  if (!event) throw new ArgumentError("Unsupported event for " + runtime);
  const command = one(context.args, "command");
  const path = one(context.args, "path");
  const tool = one(context.args, "tool");
  if ([command, path, tool].filter((value) => value !== undefined).length > 1)
    throw new ArgumentError("Choose one of --command, --path or --tool");
  const spec = specFrom(context);
  const compiled = spec.hookBundle?.policy;
  if (!compiled?.targets.includes(runtime as RuntimeId))
    throw new ArgumentError("No compiled hooks for " + runtime);
  const payload = adapter.synthetic({
    cwd: context.cwd,
    session: "pmcp-hooks-test",
    event,
    command,
    path,
    tool,
  });
  const input = adapter.normalize(event, payload, spec.root);
  if (!input || adapter.capabilities.events[input.event] === "unsupported")
    throw new ArgumentError("Unsupported event " + requested);
  if (
    (command !== undefined || path !== undefined || tool !== undefined) &&
    !["before_tool", "after_tool"].includes(input.event)
  )
    throw new ArgumentError("Tool selectors require before_tool or after_tool");
  const scratch = mkdtempSync(join(tmpdir(), "pmcp-hooks-test-"));
  try {
    // The simulated pause is the seeded one in scratch, never the project's pause_file.
    const { pauseFile: _project, ...sessions } = compiled.sessions;
    const store = createFilesStore(scratch, sessions);
    seedState(store, context.cwd, one(context.args, "session-state"));
    const report = await simulate(input, compiled, store);
    const rendered = adapter.render(input, report.decision);
    const result = {
      version: 1,
      runtime,
      event: input.event,
      payload,
      ...report,
      rendered,
    };
    if (context.args.flags.has("json"))
      context.ui.data(JSON.stringify(result) + "\n");
    if (!context.args.flags.has("json")) {
      for (const row of report.policies)
        context.ui.line(
          row.policy +
            ": " +
            row.verdict +
            " " +
            row.durationMs +
            "ms" +
            (row.skipped ? " (external effects skipped)" : "") +
            (row.reason ? " " + row.reason : "") +
            // A guard in observe, warn or graded mode: what it found, before its mode.
            (row.raw && row.raw.verdict !== row.verdict
              ? ` (${row.mode}; found ${row.raw.verdict}` +
                (row.raw.reason && row.raw.reason !== row.reason
                  ? `: ${row.raw.reason}`
                  : "") +
                ")"
              : ""),
        );
      context.ui.data(
        "Rendered (exit " + rendered.exitCode + "):\n" + rendered.stdout + "\n",
      );
    }
    return 0;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
