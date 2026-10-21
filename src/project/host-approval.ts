import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { HOST_MANIFEST, HOST_POLICY } from "./host.js";
import { projectStateDir } from "../sessions/state-dir.js";

// The operator's approved copy of the projected host files, outside every path pmcp.toml can
// name: the [sessions] state_dir override is ignored on purpose. pmcp-pty loads only this copy.
export function approvalDir(
  root: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const projects = projectStateDir(root, undefined, env);
  return join(dirname(dirname(projects)), "host-approvals", basename(projects));
}

export interface HostFiles {
  readonly manifest: string;
  readonly policy: string;
}

export function projectedFiles(root: string): HostFiles | null {
  const manifest = join(root, HOST_MANIFEST);
  const policy = join(root, HOST_POLICY);
  if (!existsSync(manifest) || !existsSync(policy)) return null;
  return {
    manifest: readFileSync(manifest, "utf8"),
    policy: readFileSync(policy, "utf8"),
  };
}

// One hash over both files, so approving one never approves a changed other.
export function hostDigest(files: HostFiles): string {
  return createHash("sha256")
    .update(`host.json\n${files.manifest}\0policy.json\n${files.policy}`)
    .digest("hex");
}

export interface Approval {
  readonly sha256: string;
  readonly approvedAt: string;
}

export function readApproval(dir: string): Approval | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, "approval.json"), "utf8"));
    const files = {
      manifest: readFileSync(join(dir, "host.json"), "utf8"),
      policy: readFileSync(join(dir, "policy.json"), "utf8"),
    };
    // A snapshot edited after approval no longer matches its own record.
    if (raw.sha256 !== hostDigest(files)) return null;
    return { sha256: raw.sha256, approvedAt: String(raw.approvedAt) };
  } catch {
    return null;
  }
}

export type ApprovalState =
  | "approved"
  | "differs"
  | "unapproved"
  | "unprojected";

export function approvalState(
  root: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): { state: ApprovalState; projected?: string; approved?: Approval } {
  const files = projectedFiles(root);
  const approved = readApproval(approvalDir(root, env)) ?? undefined;
  if (!files)
    return { state: "unprojected", ...(approved ? { approved } : {}) };
  const projected = hostDigest(files);
  if (!approved) return { state: "unapproved", projected };
  const state = approved.sha256 === projected ? "approved" : "differs";
  return { state, projected, approved };
}

const DETAIL: Record<ApprovalState, string> = {
  approved: "pmcp-pty loads this policy",
  differs:
    "the projected policy differs from the approved one, which stays in force; run pmcp harness host approve",
  unapproved:
    "not approved; pmcp-pty loads no host policy until pmcp harness host approve",
  unprojected: "run pmcp project",
};

export function hostApprovalDoctor(
  root: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): { tool: "project"; check: string; status: "ok" | "warn"; detail: string } {
  const { state } = approvalState(root, env);
  const status = state === "approved" ? "ok" : "warn";
  return {
    tool: "project",
    check: "pmcp-pty host approved",
    status,
    detail: DETAIL[state],
  };
}

function privateFile(path: string, text: string): void {
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function writeApproval(
  dir: string,
  files: HostFiles,
  now = new Date(),
): Approval {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const approval = { sha256: hostDigest(files), approvedAt: now.toISOString() };
  privateFile(join(dir, "host.json"), files.manifest);
  privateFile(join(dir, "policy.json"), files.policy);
  privateFile(
    join(dir, "approval.json"),
    `${JSON.stringify(approval, null, 2)}\n`,
  );
  return approval;
}
