import type { SessionStore } from "../../../sessions/types.js";

export function claimants(
  store: SessionStore,
  session: string,
  root: string,
): string[] {
  return store.registry
    .list()
    .filter(
      (record) =>
        record.live && record.session !== session && record.worktree === root,
    )
    .map((record) => record.alias || record.session.slice(0, 8));
}

export function claimantNotice(root: string, names: readonly string[]): string {
  return `Another live session works in ${root}: ${names.join(", ")}. Edit only files that are yours, and name every path when you commit.`;
}
