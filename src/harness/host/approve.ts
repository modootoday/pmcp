import type { HostSpec } from "../../project/host-spec.js";
import {
  approvalDir,
  approvalState,
  hostDigest,
  projectedFiles,
  writeApproval,
  type Approval,
} from "../../project/host-approval.js";
import { agentContext, type ProcessView } from "./operator.js";

export interface ApproveInput {
  readonly root: string;
  readonly host: HostSpec;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly tty: boolean;
  readonly projectedOk: boolean;
  readonly ask: (question: string) => Promise<string>;
  readonly say: (text: string) => void;
  readonly chain?: readonly ProcessView[];
}

export type ApproveResult =
  | { readonly ok: true; readonly approval: Approval; readonly dir: string }
  | { readonly ok: false; readonly reason: string };

function summary(host: HostSpec): string[] {
  const lines = [`mcp_write ${host.mcpWrite}; roots ${host.roots.join(", ")}`];
  for (const s of host.sessions)
    lines.push(
      `session ${s.name}: ${s.runtime} in ${s.cwd}, argv ${JSON.stringify(s.argv)}, restart ${s.restart}`,
    );
  for (const a of host.answers)
    lines.push(`answers ${a.runtime} ${a.dialog}: ${a.options.join(" | ")}`);
  if (host.answers.length === 0) lines.push("answers: none");
  const privateSites = host.browser.allowPrivate;
  lines.push(
    privateSites.length > 0
      ? `browser may reach private addresses: ${privateSites.join(", ")}`
      : "browser: public sites only",
  );
  for (const app of host.desktop.launch)
    lines.push(`desktop may launch ${app.name}: ${JSON.stringify(app.argv)}`);
  return lines;
}

// The operator reads what pmcp-pty will run and answer, then types the start of its hash;
// an agent, a pipe or pmcp-pty's own terminal cannot approve.
export async function approveHost(input: ApproveInput): Promise<ApproveResult> {
  const blocked = agentContext(input.env, input.chain);
  if (blocked)
    return {
      ok: false,
      reason: `refused: ${blocked}; approve from your own terminal`,
    };
  if (!input.tty)
    return {
      ok: false,
      reason: "refused: approval needs an interactive terminal",
    };
  if (!input.projectedOk)
    return {
      ok: false,
      reason:
        "the projected host files do not match pmcp.lock; run pmcp project first",
    };
  const files = projectedFiles(input.root);
  if (!files)
    return {
      ok: false,
      reason: "no projected host files; run pmcp project first",
    };
  const digest = hostDigest(files);
  const before = approvalState(input.root, input.env);
  for (const line of summary(input.host)) input.say(line);
  input.say(`sha256 ${digest}`);
  if (before.state === "approved")
    input.say("this exact policy is already approved");
  if (before.approved && before.state !== "approved")
    input.say(
      `replaces the approval of ${before.approved.sha256.slice(0, 8)} from ${before.approved.approvedAt}`,
    );
  const typed = (
    await input.ask("Type the first 8 hex digits of the sha256 to approve: ")
  ).trim();
  if (typed.toLowerCase() !== digest.slice(0, 8))
    return { ok: false, reason: "not approved: the typed digits do not match" };
  const dir = approvalDir(input.root, input.env);
  return { ok: true, approval: writeApproval(dir, files), dir };
}
