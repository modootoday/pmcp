import { dirname, join } from "node:path";

import type { CompiledPolicy } from "../compiled.js";
import type { NeutralEvent, RuntimeId } from "../contract.js";
import { createLogger, type Logger } from "../../logging/logger.js";
import {
  DEFAULT_LOG_SETTINGS,
  withEnvOverride,
} from "../../logging/settings.js";
import { fileSink, pruneLogs } from "../../logging/sinks/file.js";
import { expandPath } from "../../sessions/paths.js";
import { projectStateDir } from "../../sessions/state-dir.js";

// The trace only correlates one run's log lines; loading node:crypto for it cost about 4 ms per call.
function traceId(): string {
  const high = Math.floor(Math.random() * 2 ** 32);
  const low = Math.floor(Math.random() * 2 ** 32);
  return `${high.toString(16).padStart(8, "0")}${low.toString(16).padStart(8, "0")}`;
}

export function hookLogger(
  root: string,
  compiled: CompiledPolicy | null,
  runtime: RuntimeId,
  event: NeutralEvent,
): Logger {
  const settings = withEnvOverride(
    compiled?.log ?? DEFAULT_LOG_SETTINGS,
    process.env["PMCP_LOG"],
  );
  const file = compiled?.logFile
    ? expandPath(root, compiled.logFile)
    : undefined;
  const dir = file
    ? dirname(file)
    : join(projectStateDir(root, compiled?.stateDir), "logs");
  const sink = fileSink({
    dir,
    ...(file ? { file } : {}),
    maxBytes: settings.maxFileMb * 1024 * 1024,
  });
  // Run retention per session to keep filesystem work off the common hook path.
  if (event === "session_start" && !file) pruneLogs(dir, settings.keepDays);
  return createLogger(sink, settings, {
    component: "hooks.entry",
    trace: traceId(),
    runtime,
    event,
  });
}
