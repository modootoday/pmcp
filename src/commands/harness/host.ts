import { createInterface } from "node:readline/promises";

import { ArgumentError, type CommandContext } from "../../cli/command.js";
import { approvalDir, approvalState } from "../../project/host-approval.js";
import { approveHost } from "../../harness/host/approve.js";
import { hostDoctor } from "../../project/host.js";
import { specFrom } from "../project/spec-from.js";

async function ask(question: string): Promise<string> {
  const prompt = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    return await prompt.question(question);
  } finally {
    prompt.close();
  }
}

const VERBS = ["approve", "status", "up", "down", "unit"];

// pmcp harness host approve | status | up | down | unit: the operator's gate over the projected
// [host] files, and running what was approved through pmcp-pty.
export async function runHost(context: CommandContext): Promise<number> {
  const [, verb, ...extra] = context.args.positional;
  if (extra.length > 0 || !verb || !VERBS.includes(verb))
    throw new ArgumentError(`Provide host ${VERBS.join(" | ")}`);
  const spec = specFrom(context);
  if (!spec.host) throw new ArgumentError("pmcp.toml has no [host] table");
  if (verb === "up" || verb === "down" || verb === "unit") {
    const { runHostVerb } = await import("./host-run.js");
    return runHostVerb(verb, spec, context);
  }
  if (verb === "status") {
    const state = approvalState(spec.root, context.env);
    context.ui.data(
      `${JSON.stringify({ ok: true, ...state, dir: approvalDir(spec.root, context.env) })}\n`,
    );
    return state.state === "approved" ? 0 : 1;
  }
  const result = await approveHost({
    root: spec.root,
    host: spec.host,
    env: context.env,
    tty: process.stdin.isTTY === true && process.stderr.isTTY === true,
    projectedOk: hostDoctor(spec).every((f) => f.status === "ok"),
    ask,
    say: (text) => process.stderr.write(`${text}\n`),
  });
  context.ui.data(`${JSON.stringify(result)}\n`);
  return result.ok ? 0 : 1;
}
