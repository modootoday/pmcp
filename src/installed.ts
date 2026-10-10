import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface InstalledDependency {
  readonly name: string;
  readonly requestedAs: string;
  readonly version: string;
}

export interface DependencyIssue {
  readonly name: string;
  readonly reason: "not_installed" | "unreadable_manifest" | "invalid_manifest";
}

export interface InstalledInventory {
  readonly dependencies: readonly InstalledDependency[];
  readonly issues: readonly DependencyIssue[];
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function absent(error: unknown): boolean {
  return object(error) && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

function packageName(name: string): boolean {
  return /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/u.test(name);
}

function locate(
  name: string,
  project: string,
): InstalledDependency | DependencyIssue {
  let directory = project;
  for (;;) {
    let source: string;
    try {
      source = readFileSync(
        join(directory, "node_modules", name, "package.json"),
        "utf8",
      );
    } catch (error) {
      if (!absent(error)) return { name, reason: "unreadable_manifest" };
      const parent = dirname(directory);
      if (parent === directory) return { name, reason: "not_installed" };
      directory = parent;
      continue;
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(source);
    } catch {
      return { name, reason: "invalid_manifest" };
    }
    if (
      !object(manifest) ||
      typeof manifest.name !== "string" ||
      !packageName(manifest.name) ||
      typeof manifest.version !== "string" ||
      manifest.version.trim() === ""
    ) {
      return { name, reason: "invalid_manifest" };
    }
    return {
      name: manifest.name,
      requestedAs: name,
      version: manifest.version,
    };
  }
}

/** Declared ranges never substitute for an installed package's version. */
export function readInstalledDependencies(
  projectDirectory: string,
): InstalledInventory {
  const project = resolve(projectDirectory);
  const manifest: unknown = JSON.parse(
    readFileSync(join(project, "package.json"), "utf8"),
  );
  if (!object(manifest))
    throw new Error("project package.json must contain an object");

  const names = new Set<string>();
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const declared = manifest[field];
    if (declared === undefined) continue;
    if (!object(declared)) throw new Error(`${field} must contain an object`);
    for (const [name, range] of Object.entries(declared)) {
      if (!packageName(name) || typeof range !== "string") {
        throw new Error(`invalid dependency declaration in ${field}`);
      }
      names.add(name);
    }
  }

  const dependencies: InstalledDependency[] = [];
  const issues: DependencyIssue[] = [];
  for (const name of [...names].sort()) {
    const result = locate(name, project);
    if ("reason" in result) issues.push(result);
    else dependencies.push(result);
  }
  return { dependencies, issues };
}
