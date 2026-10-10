import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import semver from "semver";
import type { InstalledInventory } from "../installed.js";
import type { RemoteCatalog, RemoteEntry } from "../remote/catalog.js";

export interface SkillMatch {
  readonly targetName: string;
  readonly targetVersion: string;
  readonly verified: boolean;
  readonly entry: RemoteEntry;
}

export function matchingSkills(
  catalog: RemoteCatalog,
  inventory: InstalledInventory,
): SkillMatch[] {
  const matches: SkillMatch[] = [];
  for (const dependency of inventory.dependencies) {
    for (const entry of catalog.entries) {
      const target = entry.targets.find(
        (target) => target.packageName === dependency.name,
      );
      if (target && semver.satisfies(dependency.version, target.range)) {
        matches.push({
          targetName: dependency.name,
          targetVersion: dependency.version,
          verified: target.verifiedVersions.includes(dependency.version),
          entry,
        });
      }
    }
  }
  return matches;
}

interface ProjectManifest {
  readonly packageManager?: string;
  readonly workspaces?: unknown;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}
const LOCKS = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "bun.lock",
  "bun.lockb",
  "yarn.lock",
  "pnpm-lock.yaml",
];

export interface InstallContext {
  readonly project: string;
  readonly root: string;
  readonly manager: "npm" | "bun";
  readonly manifest: ProjectManifest;
  readonly files: readonly string[];
  readonly fingerprint: string;
}

export function fingerprint(files: readonly string[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file).update("\0");
    try {
      hash.update(readFileSync(file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      hash.update("absent");
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

function manifestAt(directory: string): ProjectManifest {
  const value: unknown = JSON.parse(
    readFileSync(join(directory, "package.json"), "utf8"),
  );
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid project manifest");
  return value as ProjectManifest;
}

export function installContext(directory: string): InstallContext {
  const project = resolve(directory);
  const manifest = manifestAt(project);
  let root = project;
  let ancestor = project;
  for (;;) {
    if (ancestor !== project && existsSync(join(ancestor, "package.json"))) {
      const candidate = manifestAt(ancestor);
      if (candidate.workspaces !== undefined) {
        root = ancestor;
        break;
      }
      if (LOCKS.some((file) => existsSync(join(ancestor, file)))) break;
    }
    if (existsSync(join(ancestor, ".git")) || dirname(ancestor) === ancestor)
      break;
    ancestor = dirname(ancestor);
  }
  const owner = manifestAt(root);
  const lockNames = LOCKS.filter((file) => existsSync(join(root, file)));
  const lockManagers = new Set(
    lockNames.map((file) => {
      if (file.startsWith("bun.")) return "bun";
      if (file === "package-lock.json" || file === "npm-shrinkwrap.json")
        return "npm";
      return "unsupported";
    }),
  );
  if (lockManagers.size > 1 || lockManagers.has("unsupported"))
    throw new Error("conflicting or unsupported package manager lockfiles");
  const declared = owner.packageManager?.match(
    /^(npm|bun)@\d+\.\d+\.\d+(?:[-+].+)?$/u,
  )?.[1];
  if (owner.packageManager !== undefined && !declared)
    throw new Error("only npm and Bun projects are supported");
  const locked = [...lockManagers][0];
  if (declared && locked && declared !== locked)
    throw new Error("packageManager and lockfile disagree");
  const manager = declared ?? locked;
  if (manager !== "npm" && manager !== "bun")
    throw new Error(
      "declare packageManager or install project dependencies first",
    );
  if (
    root !== project &&
    LOCKS.some((file) => existsSync(join(project, file)))
  ) {
    throw new Error(
      "nested project has its own lockfile; resolve the workspace boundary first",
    );
  }
  const files = [
    ...new Set([
      join(root, "package.json"),
      join(project, "package.json"),
      ...LOCKS.map((file) => join(root, file)),
    ]),
  ];
  return {
    project,
    root,
    manager,
    manifest,
    files,
    fingerprint: fingerprint(files),
  };
}

export interface InstallPlan {
  readonly catalogRevision: string;
  readonly context: InstallContext;
  readonly changes: readonly RemoteEntry["delivery"][];
  /** Lines in this plan that an advisory has reached. */
  readonly recalled: readonly {
    readonly packageName: string;
    readonly line: NonNullable<RemoteEntry["line"]>;
  }[];
  readonly command: {
    readonly executable: string;
    readonly args: readonly string[];
    readonly cwd: string;
  };
}

export function planInstall(options: {
  context: InstallContext;
  catalog: RemoteCatalog;
  inventory: InstalledInventory;
  selected: readonly string[];
  all: boolean;
  sync: boolean;
}): InstallPlan {
  if (options.inventory.issues.length)
    throw new Error(
      "resolve missing or invalid installed dependencies before changing skills",
    );
  const { context, catalog } = options;
  const matched = matchingSkills(catalog, options.inventory);
  const available = new Set(
    matched.map((match) => match.entry.delivery.packageName),
  );
  if (options.sync && (options.selected.length || options.all))
    throw new Error("sync accepts neither package arguments nor --all");
  if (!options.sync && !options.all && options.selected.length === 0)
    throw new Error("select a skill package or pass --all");
  for (const name of options.selected)
    if (!available.has(name))
      throw new Error(
        "a selected skill package does not match the installed dependencies",
      );

  const wanted = new Set(options.selected);
  const entries = new Map<string, RemoteEntry>();
  const published = new Map<string, string>();
  for (const match of matched) {
    const entry = match.entry;
    const name = entry.delivery.packageName;
    const declared = Object.hasOwn(
      context.manifest.devDependencies ?? {},
      name,
    );
    if (options.sync ? !declared : !options.all && !wanted.has(name)) continue;
    if (
      Object.hasOwn(context.manifest.dependencies ?? {}, name) ||
      Object.hasOwn(context.manifest.optionalDependencies ?? {}, name)
    ) {
      throw new Error(
        "a skill package is already declared outside devDependencies",
      );
    }
    const identity = `${name}@${entry.delivery.version}`;
    const hash = published.get(identity);
    if (hash && hash !== entry.delivery.integrity)
      throw new Error("conflicting integrity for one package version");
    published.set(identity, entry.delivery.integrity);
    const current = entries.get(name);
    if (!current || semver.gt(entry.delivery.version, current.delivery.version))
      entries.set(name, entry);
  }
  const changes = [...entries.values()]
    .filter((entry) => {
      const installed = options.inventory.dependencies.find(
        (dependency) => dependency.requestedAs === entry.delivery.packageName,
      );
      if (installed && installed.name !== entry.delivery.packageName)
        throw new Error("skill package aliases require explicit migration");
      if (installed && semver.gt(installed.version, entry.delivery.version))
        throw new Error("catalog would downgrade an installed skill package");
      return !installed || installed.version !== entry.delivery.version;
    })
    .sort((a, b) =>
      a.delivery.packageName.localeCompare(b.delivery.packageName),
    );

  // A recalled line must not be installed without saying so. The plan carries
  // it because `changes` is only the delivery, and a caller holding a package
  // name has no way back to the standing that came with it.
  const recalled = changes
    .filter((entry) => entry.line?.status === "recalled")
    .map((entry) => ({
      packageName: entry.delivery.packageName,
      line: entry.line!,
    }));

  const deliveries = changes.map((entry) => entry.delivery);
  const specs = deliveries.map(
    (entry) => `${entry.packageName}@${entry.version}`,
  );
  let args: string[];
  if (context.manager === "npm") {
    args = [
      "install",
      "--save-dev",
      "--save-exact",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ];
    if (context.project !== context.root)
      args.push(
        `--workspace=${relative(context.root, context.project).split(sep).join("/")}`,
      );
  } else {
    args = ["add", "--dev", "--exact", "--ignore-scripts"];
  }
  args.push(...specs);
  return {
    catalogRevision: catalog.revision,
    context,
    changes: deliveries,
    recalled,
    command: {
      executable: context.manager,
      args,
      cwd: context.manager === "npm" ? context.root : context.project,
    },
  };
}
