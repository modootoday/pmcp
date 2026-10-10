import semver from "semver";
import type { InstalledInventory } from "../installed.js";
import type { RemoteCatalog, RemoteEntry } from "../remote/catalog.js";
import type { InstallContext } from "./context.js";
import { installationCommand } from "./manager.js";
export { installContext, fingerprint, type InstallContext } from "./context.js";

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
  return {
    catalogRevision: catalog.revision,
    context,
    changes: deliveries,
    recalled,
    command: installationCommand(context, specs),
  };
}
