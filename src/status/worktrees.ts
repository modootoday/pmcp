import { dirname, relative, resolve, sep } from "node:path";
import type { ProjectConfig } from "../config.js";
import { readGitConfig } from "../git/config.js";
import { defaultMainline, defaultRemote } from "../git/detect.js";
import { counts } from "./ref-counts.js";
import type { WorktreeRow } from "../git/worktrees/list.js";
import { checkoutOf, worktreesOf } from "../sessions/checkout.js";

export function desks(config: ProjectConfig): WorktreeRow[] {
  const settings = readGitConfig(config);
  if (!settings?.worktrees) return [];
  const checkout = checkoutOf(config.dir);
  if (!checkout) return [];
  const root = resolve(dirname(checkout.commonDir), settings.worktrees.root);
  const found = worktreesOf(checkout).flatMap((entry) => {
    const alias = relative(root, entry.path);
    if (!alias || alias.startsWith("..") || alias.includes(sep)) return [];
    return [{ ...entry, alias }];
  });
  if (!found.length) return [];
  const remote = defaultRemote(config.dir, settings.remote);
  const mainline = defaultMainline(config.dir, remote, settings.mainline);
  return found.map((entry) => ({
    path: entry.path,
    branch: entry.branch,
    alias: entry.alias,
    main: false,
    ...(counts(entry.path, remote + "/" + mainline) ?? {}),
  }));
}
