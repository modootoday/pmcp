import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import {
  frontmatterObject,
  metadataOf,
  specProblems,
  stringFields,
} from "../frontmatter.js";
import { readMarketplace } from "../marketplace.js";
import type { SkillEntry } from "./types.js";
import type { CatalogOptions } from "./types.js";
import { kindOf } from "./_shared.js";
import { skillFiles } from "./packages.js";
import { packageDirs } from "./packages.js";
import { nameOf } from "./packages.js";
import { expandRootGlob } from "./globs.js";
import { workspacePackageDirs } from "./workspaces.js";
export function readCatalog(options: CatalogOptions): SkillEntry[] {
  const scopes = options.scopes ?? [];
  const found: SkillEntry[] = [];
  const seen = new Set<string>();
  const seenPaths = new Set<string>();
  const direct = new Set(options.packages ?? []);
  const packageDirsToRead = [
    ...options.roots.flatMap(packageDirs),
    ...direct,
    ...(options.workspaces ?? [])
      .flatMap(expandRootGlob)
      .flatMap(workspacePackageDirs),
  ];
  for (const packageDir of packageDirsToRead) {
    const packageName = nameOf(packageDir, direct.has(packageDir));
    if (packageName === "") continue;
    if (scopes.length > 0 && !scopes.some((s) => packageName.startsWith(s))) {
      continue;
    }
    for (const path of skillFiles(packageDir)) {
      if (seenPaths.has(path)) continue;
      seenPaths.add(path);
      let source: string;
      try {
        source = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      const parsed = frontmatterObject(source);
      const front = stringFields(parsed);
      const description = front["description"] ?? "";
      if (description === "") continue;
      const dirName = basename(dirname(path));
      const slug =
        front["name"] ??
        (dirName === basename(packageDir) ? packageName : dirName);
      const name = `${packageName}/${slug}`;
      if (seen.has(name)) {
        if (!path.includes("/node_modules/"))
          options.onWarning?.({
            path,
            reason: `duplicate name ${name}; the first one found is served`,
          });
        continue;
      }
      seen.add(name);
      for (const problem of specProblems(parsed, dirName))
        options.onWarning?.({ path, reason: problem });
      const metadata = metadataOf(parsed);
      found.push({
        name,
        package: packageName,
        slug,
        description,
        path,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      });
    }
  }
  for (const dir of options.marketplaces ?? []) {
    for (const entry of readMarketplace(dir, options.onReject)) {
      if (seen.has(entry.name)) {
        options.onReject?.({
          path: entry.path,
          reason: `duplicate name ${entry.name}`,
        });
        continue;
      }
      seen.add(entry.name);
      if (kindOf(entry) === "skill" && basename(entry.path) === "SKILL.md") {
        const parsed = frontmatterObject(readFileSync(entry.path, "utf8"));
        for (const problem of specProblems(
          parsed,
          basename(dirname(entry.path)),
        ))
          options.onWarning?.({ path: entry.path, reason: problem });
      }
      found.push(entry);
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}
