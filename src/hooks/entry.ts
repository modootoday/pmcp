// Keep the entry dependency graph small so each projected hook stays within its startup budget.

import { dirname, resolve } from "node:path";

import { NEUTRAL_EVENTS, type NeutralEvent } from "./contract.js";
import { dispatch } from "./dispatch.js";
import { failClosed, failedEntry, rawFailure } from "./entry/fail-closed.js";
import {
  PolicyIntegrityError,
  readCompiled,
  type CompiledPolicy,
} from "./compiled.js";
import type { HookInput } from "./contract.js";
import { hookLogger } from "./entry/logger.js";
import { stateDirAnswer } from "./entry/state-dir.js";
import { readStdin, writeStdout } from "./entry/stdin.js";
import { gitProbe } from "./policies/git-probe.js";
import { guestFor, runtime } from "./runtimes/index.js";
import { createFilesStore } from "../sessions/files-store.js";
import { leaseFilesFor } from "../sessions/lease-files.js";
import { projectStateDir } from "../sessions/state-dir.js";
import type { Logger } from "../logging/logger.js";

export async function main(
  argv: readonly string[],
  root: string,
): Promise<number> {
  if (argv[0] === "--state-dir") {
    writeStdout(stateDirAnswer(root));
    return 0;
  }
  const projected = runtime(argv[0] ?? "");
  const event = argv[1] as NeutralEvent;
  if (
    !projected ||
    !NEUTRAL_EVENTS.includes(event) ||
    !projected.nativeEvent(event)
  ) {
    process.stderr.write("usage: hook.mjs <runtime> <event>\n");
    return 2;
  }
  const started = performance.now();
  let log: Logger | null = null;
  let adapter = projected;
  const pass = () => {
    if (adapter.silent) writeStdout(adapter.silent(event));
    return 0;
  };
  let compiled: CompiledPolicy | null = null;
  let payload: unknown = null;
  let input: HookInput | null = null;
  try {
    compiled = readCompiled(root);
    payload = JSON.parse(readStdin() || "{}");
    adapter = guestFor(projected, payload, compiled.targets);
    log = hookLogger(root, compiled, adapter.id, event);
    if (!compiled.targets.includes(adapter.id)) return pass();
    const native = adapter.nativeEvent(event);
    input = native ? adapter.normalize(native, payload, root) : null;
    if (!input) return pass();
    const run = log.child({ session: input.session.id });
    const stateDir = projectStateDir(root, compiled.stateDir);
    const store = createFilesStore(stateDir, {
      ...compiled.sessions,
      leaseFiles: leaseFilesFor(
        root,
        stateDir,
        compiled.sessions.leaseFiles,
        compiled.sessions.gate,
        process.env,
      ),
    });
    const decision = await dispatch(input, compiled, {
      log: run,
      git: gitProbe,
      store,
      ...(compiled.policySha256 ? { policySha256: compiled.policySha256 } : {}),
      now: () => performance.now(),
    });
    const out = adapter.render(input, decision);
    writeStdout(out.stdout);
    const duration_ms = Math.round(performance.now() - started);
    run.info("hook", {
      verdict: decision.verdict,
      duration_ms,
      tool: input.tool?.native,
    });
    return out.exitCode;
  } catch (error) {
    log ??= hookLogger(root, null, adapter.id, event);
    log.error("hook failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const failure =
      error instanceof PolicyIntegrityError
        ? undefined
        : (compiled?.failure ?? rawFailure(root));
    if (failure) {
      if (!input && payload !== null) {
        try {
          const native = adapter.nativeEvent(event);
          input = native ? adapter.normalize(native, payload, root) : null;
        } catch {
          input = null;
        }
      }
      writeStdout(failedEntry(adapter, event, root, input, failure, error));
      return 0;
    }
    writeStdout(failClosed(adapter, event, root, error));
    return 0;
  }
}

// The projected loader imports this as hook-body.mjs and calls main; run directly, it runs itself.
const self = import.meta.filename;
if (process.argv[1] && resolve(process.argv[1]) === self) {
  process.exitCode = await main(
    process.argv.slice(2),
    resolve(dirname(self), "../.."),
  );
}
