import { dirname, join } from "node:path";

import { ArgumentError, type CommandContext } from "../../cli/command.js";
import {
  defaultPtySocket,
  ptyRequest,
} from "../../harness/adapters/pty/client.js";
import {
  ensureDaemon,
  startDaemon,
  unitText,
} from "../../harness/host/daemon.js";
import { hostDown, hostUp, type HostRun } from "../../harness/host/up.js";
import { approvalDir, approvalState } from "../../project/host-approval.js";
import type { ProjectSpec } from "../../project/spec.js";
import { projectStateDir } from "../../sessions/state-dir.js";

function socketOf(context: CommandContext): string {
  const socket = defaultPtySocket(context.env);
  if (!socket)
    throw new ArgumentError("Set PMCP_PTY_SOCKET or XDG_RUNTIME_DIR");
  return socket;
}

// up and down use only the operator's approved copy; a newer projection waits for approval.
function approvedRun(spec: ProjectSpec, context: CommandContext): HostRun {
  const state = approvalState(spec.root, context.env);
  if (!state.approved)
    throw new ArgumentError(
      "no approved host policy: run pmcp project, then pmcp harness host approve in your own terminal",
    );
  const socket = socketOf(context);
  return {
    root: spec.root,
    approvedDir: approvalDir(spec.root, context.env),
    journal: join(
      projectStateDir(spec.root, undefined, context.env),
      "host-runs.jsonl",
    ),
    call: (request, limitMs) => ptyRequest(socket, request, limitMs),
    env: context.env,
  };
}

export async function runHostVerb(
  verb: string,
  spec: ProjectSpec,
  context: CommandContext,
): Promise<number> {
  if (verb === "unit") {
    const dir = approvalDir(spec.root, context.env);
    context.ui.data(unitText(socketOf(context), dir, context.env));
    return 0;
  }
  const run = approvedRun(spec, context);
  const differs = approvalState(spec.root, context.env).state === "differs";
  if (verb === "down") {
    const steps = await hostDown(run);
    context.ui.data(`${JSON.stringify({ ok: true, steps })}\n`);
    return 0;
  }
  const socket = socketOf(context);
  const log = join(dirname(run.journal), "host-daemon.log");
  const daemon = await ensureDaemon(
    run.call,
    () => startDaemon(socket, run.approvedDir, context.env, log),
    log,
  );
  const steps = await hostUp(run);
  const warnings = [
    ...(differs
      ? [
          "the projected policy differs from the approved one, which is the one running",
        ]
      : []),
    ...(daemon.policy !== "host-approval"
      ? [
          `the running pmcp-pty loaded policy ${daemon.policy}, not the approved copy; restart it with --host`,
        ]
      : []),
  ];
  const ok = steps.every((s) => s.action !== "refused");
  context.ui.data(`${JSON.stringify({ ok, daemon, steps, warnings })}\n`);
  return ok ? 0 : 1;
}
