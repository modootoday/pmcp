// Serve links so hosts can materialize skill files without copying their bytes through the model.

import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import type { SkillEntry } from "../catalog.js";
import { assetRoot } from "../marketplace.js";
import { classify } from "../mime.js";
import { listSkillFiles, type SkillFile } from "./list.js";
import { skillFileUri } from "./uri.js";

export interface BundleFile extends SkillFile {
  readonly uri: string;
  readonly mimeType: string;
}

export interface SkillBundle {
  readonly name: string;
  readonly files: readonly BundleFile[];
  readonly truncated: boolean;
}

export function bundleSkill(entry: SkillEntry): SkillBundle {
  const root = assetRoot(entry);
  const base = statSync(root).isFile() ? dirname(root) : root;
  const listing = listSkillFiles(root);
  return {
    name: entry.name,
    truncated: listing.truncated,
    files: listing.files.map((file) => ({
      ...file,
      uri: skillFileUri(entry, file.path),
      mimeType: classify(file.path, readFileSync(join(base, file.path)))
        .mimeType,
    })),
  };
}
