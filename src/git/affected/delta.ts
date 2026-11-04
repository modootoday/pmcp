import { git } from "../exec.js";

export interface Change {
  readonly path: string;
  // A, M, D or T; renames arrive as a deletion and an addition.
  readonly status: string;
}

export type Delta =
  | {
      readonly ok: true;
      readonly base: string;
      readonly head: string;
      readonly changes: readonly Change[];
    }
  | { readonly ok: false; readonly reason: string };

function commitOf(root: string, ref: string): string | null {
  const run = git(root, [
    "rev-parse",
    "--verify",
    "--quiet",
    `${ref}^{commit}`,
  ]);
  return run.status === 0 ? run.stdout.trim() : null;
}

// Every refusal to compute a delta is a reason to check everything: an empty delta would pass.
export function readDelta(
  root: string,
  baseRef: string,
  headRef: string,
): Delta {
  const base = commitOf(root, baseRef);
  if (base === null)
    return { ok: false, reason: `base ${baseRef} does not resolve` };
  const head = commitOf(root, headRef);
  if (head === null)
    return { ok: false, reason: `head ${headRef} does not resolve` };
  if (base === head) return { ok: false, reason: "base equals head" };
  const run = git(root, [
    "diff",
    "--name-status",
    "--no-renames",
    "--no-ext-diff",
    "-z",
    `${base}...${head}`,
  ]);
  if (run.status !== 0)
    return { ok: false, reason: `git diff failed: ${run.stderr.trim()}` };
  const fields = run.stdout.split("\0");
  const changes: Change[] = [];
  for (let at = 0; at + 1 < fields.length; at += 2) {
    const status = fields[at]!.charAt(0);
    const path = fields[at + 1]!;
    if (status && path) changes.push({ path, status });
  }
  return { ok: true, base, head, changes };
}

// A file's text at a revision, or null when the revision does not hold it.
export function showFile(
  root: string,
  rev: string,
  path: string,
): string | null {
  const run = git(root, ["show", `${rev}:${path}`]);
  return run.status === 0 ? run.stdout : null;
}
