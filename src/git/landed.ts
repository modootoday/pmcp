import { git, gitText } from "./exec.js";
import { pinsSuperseded } from "./superseded.js";

export interface CherryLines {
  readonly carried: readonly string[];

  readonly missing: readonly string[];
}

export function cherry(
  cwd: string,
  upstream: string,
  head = "HEAD",
): CherryLines {
  const listed = git(cwd, ["cherry", "-v", upstream, head]).stdout;
  const carried: string[] = [];
  const missing: string[] = [];
  for (const line of listed.split("\n")) {
    if (line.startsWith("- ")) carried.push(line.slice(2));
    if (!line.startsWith("+ ")) continue;
    const sha = line.slice(2).split(" ")[0] ?? "";
    // A pin the upstream already reaches is landed, though no patch there matches it.
    if (pinsSuperseded(cwd, upstream, sha)) carried.push(line.slice(2));
    else missing.push(line.slice(2));
  }
  return { carried, missing };
}

export function undelivered(
  cwd: string,
  upstream: string,
  named: readonly string[],
): string[] {
  if (named.length === 0)
    return cherry(cwd, upstream).missing.map(
      (line) => line.split(" ")[0] ?? "",
    );
  const shas: string[] = [];
  for (const ref of named) {
    const sha = gitText(cwd, [
      "rev-parse",
      "--verify",
      "-q",
      `${ref}^{commit}`,
    ]);
    if (!sha) throw new Error(`${ref} is not a commit`);
    const listed = git(cwd, ["cherry", upstream, sha, `${sha}^`]).stdout;
    if (listed.startsWith("+ ") && !pinsSuperseded(cwd, upstream, sha))
      shas.push(sha);
  }
  return shas;
}

export function touchedPaths(
  cwd: string,
  commits: readonly string[],
): Set<string> {
  const paths = new Set<string>();
  for (const sha of commits) {
    const listed = gitText(cwd, [
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      sha,
    ]);
    for (const path of listed.split("\n")) {
      if (path) paths.add(path);
    }
  }
  return paths;
}

export function isAncestor(cwd: string, ancestor: string, of: string): boolean {
  return git(cwd, ["merge-base", "--is-ancestor", ancestor, of]).status === 0;
}

export function distance(
  cwd: string,
  upstream: string,
): { behind: number; ahead: number } | null {
  const counted = gitText(cwd, [
    "rev-list",
    "--left-right",
    "--count",
    `${upstream}...HEAD`,
  ]);
  if (!counted) return null;
  const [behind = 0, ahead = 0] = counted.split(/\s+/u).map(Number);
  return { behind, ahead };
}
