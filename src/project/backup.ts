import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { ProjectError } from "./package-rules.js";

export function backupFiles(root: string, paths: readonly string[]): string {
  const base = join(homedir(), ".cache/pmcp/project-backups");
  const inside = relative(resolve(root), resolve(base));
  if (
    !isAbsolute(inside) &&
    inside !== ".." &&
    !inside.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new ProjectError("Project backups must be outside the project");
  }
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const directory = lstatSync(base);
  if (directory.isSymbolicLink() || !directory.isDirectory()) {
    throw new ProjectError("Project backup directory must be a real directory");
  }
  if (
    process.getuid &&
    (directory.uid !== process.getuid() || (directory.mode & 0o077) !== 0)
  ) {
    throw new ProjectError(
      "Project backup directory must be private and operator-owned",
    );
  }
  const snapshots = [...new Set(paths)].map((path) => {
    const absolute = resolve(root, path);
    const within = relative(resolve(root), absolute);
    if (
      isAbsolute(within) ||
      within === ".." ||
      within.startsWith("../") ||
      within.startsWith("..\\")
    ) {
      throw new ProjectError("Backup paths must stay inside the project");
    }
    if (!existsSync(absolute)) {
      return { path, contents: null };
    }
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new ProjectError(
        `Refusing to back up a nonregular config file: ${path}`,
      );
    }
    return { path, contents: readFileSync(absolute) };
  });
  const destination = mkdtempSync(join(base, "project-"));
  const entries = snapshots.map(({ path, contents }) => {
    if (contents === null) {
      return { path, present: false };
    }
    const output = join(destination, "files", path);
    mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
    writeFileSync(output, contents, { mode: 0o600 });
    return {
      path,
      present: true,
      sha256: createHash("sha256").update(contents).digest("hex"),
    };
  });
  writeFileSync(
    join(destination, "receipt.json"),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        projectRoot: resolve(root),
        entries,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  return destination;
}
