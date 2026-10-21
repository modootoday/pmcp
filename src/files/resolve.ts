// Confine reads to the skill root so links cannot expose unrelated files.

import { realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import type { SkillEntry } from "../catalog.js";
import { assetRoot } from "../marketplace.js";

export type FileRefusal = {
  readonly ok: false;
  readonly error: "path_outside_skill" | "no_such_file";
  readonly detail: string;
};

export type ResolvedFile = {
  readonly ok: true;

  readonly target: string;

  readonly path: string;
};

export const ownFile = (entry: SkillEntry): string =>
  relative(assetRoot(entry), entry.path).split(sep).join("/");

export function resolveSkillFile(
  entry: SkillEntry,
  wanted: string = ownFile(entry),
): ResolvedFile | FileRefusal {
  if (isAbsolute(wanted) || wanted.split(/[\\/]/u).includes("..")) {
    return { ok: false, error: "path_outside_skill", detail: wanted };
  }
  const scope = realpathSync(assetRoot(entry));

  const single = statSync(scope).isFile();
  const root = single ? dirname(scope) : scope;
  let target: string;
  try {
    target = realpathSync(
      single && wanted === "" ? scope : resolve(root, wanted),
    );
  } catch {
    return { ok: false, error: "no_such_file", detail: wanted };
  }
  const inside = single
    ? target === scope
    : target === root || target.startsWith(root + sep);
  if (!inside)
    return { ok: false, error: "path_outside_skill", detail: wanted };
  return {
    ok: true,
    target,
    path: relative(root, target).split(sep).join("/"),
  };
}
