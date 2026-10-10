import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { RemoteCatalog, RemoteEntry } from "../remote/catalog.js";
import { contentDigest } from "./verify-content.js";
import { integrity, readArchive } from "./archive.js";
import type { InstallPlan } from "./plan.js";
import { installedPackageDirectory } from "../installed.js";

const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;

export interface PublicDelivery {
  readonly integrity: ReadonlyMap<string, string>;
  readonly resources: ReadonlyMap<string, ReadonlyMap<string, Buffer>>;
}

export function publicArchiveUrl(entry: RemoteEntry): string {
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.productId) ||
    entry.line === undefined
  )
    throw new Error(
      "The public catalog requires a product identifier and major line",
    );
  return `https://pmcp.build/skills/${entry.productId}/${entry.line.major}/releases/${entry.delivery.version}.tgz`;
}

function publicEntry(
  catalog: RemoteCatalog,
  change: RemoteEntry["delivery"],
): RemoteEntry {
  const entry = catalog.entries.find(
    (item) =>
      item.delivery.packageName === change.packageName &&
      item.delivery.version === change.version,
  );
  if (!entry || entry.delivery.integrity !== change.integrity)
    throw new Error("The public delivery is absent from the catalog");
  return entry;
}

export function publicInstallPlan<
  T extends Pick<InstallPlan, "changes" | "command">,
>(plan: T, catalog: RemoteCatalog): T {
  const specs = new Map(
    plan.changes.map((change) => [
      `${change.packageName}@${change.version}`,
      `${change.packageName}@${publicArchiveUrl(publicEntry(catalog, change))}`,
    ]),
  );
  return {
    ...plan,
    command: {
      ...plan.command,
      args: plan.command.args.map(
        (argument) => specs.get(argument) ?? argument,
      ),
    },
  };
}

export function publicArchiveFiles(
  entry: RemoteEntry,
  bytes: Buffer,
): ReadonlyMap<string, Buffer> {
  if (
    bytes.length > MAX_ARCHIVE_BYTES ||
    integrity(bytes) !== entry.delivery.integrity
  )
    throw new Error("Public archive integrity differs from the catalog");
  const files = readArchive(bytes);
  const manifest: unknown = JSON.parse(
    files.get("package/package.json")?.toString("utf8") ?? "null",
  );
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
    throw new Error("Public archive has no package manifest");
  const metadata = manifest as Record<string, unknown>;
  if (
    metadata.name !== entry.delivery.packageName ||
    metadata.version !== entry.delivery.version
  )
    throw new Error("Public archive identity differs from the catalog");
  for (const key of [
    "scripts",
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
    "bundledDependencies",
    "bundleDependencies",
    "bin",
    "workspaces",
  ])
    if (metadata[key] !== undefined)
      throw new Error("Public skill packages must be content-only");
  const skills = new Map<string, string>();
  if (!files.has("package/LICENSE"))
    throw new Error("Public skill packages must include their license");
  for (const [path, content] of files) {
    if (path === "package/package.json" || path === "package/LICENSE") continue;
    if (
      !/^package\/skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/(?:SKILL\.md|references\/.+)$/u.test(
        path,
      )
    )
      throw new Error("Public archive contains an unexpected resource");
    if (path.endsWith("/SKILL.md"))
      skills.set(path.slice("package/".length), content.toString("utf8"));
  }
  if (skills.size !== 1 || contentDigest(skills) !== entry.contentDigest)
    throw new Error("Public skill content differs from the catalog");
  return files;
}

async function downloadArchive(
  url: string,
  fetcher: typeof fetch,
): Promise<Buffer> {
  const response = await fetcher(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok || !response.body)
    throw new Error(`Public archive request failed (${response.status})`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ARCHIVE_BYTES)
        throw new Error("Public archive exceeds the download budget");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export async function preparePublicDelivery(
  plan: Pick<InstallPlan, "changes">,
  catalog: RemoteCatalog,
  fetcher: typeof fetch = fetch,
): Promise<PublicDelivery> {
  const verified = new Map<string, string>();
  const resources = new Map<string, ReadonlyMap<string, Buffer>>();
  for (const change of plan.changes) {
    const entry = publicEntry(catalog, change);
    const url = publicArchiveUrl(entry);
    const bytes = await downloadArchive(url, fetcher);
    resources.set(change.packageName, publicArchiveFiles(entry, bytes));
    const identity = `${change.packageName}@${change.version}`;
    verified.set(identity, integrity(bytes));
  }
  return { integrity: verified, resources };
}

export function verifyPublicDelivery(
  project: string,
  delivery: PublicDelivery,
): void {
  for (const [name, files] of delivery.resources) {
    const root = installedPackageDirectory(project, name);
    const expected = new Set(
      [...files.keys()].map((path) => path.slice("package/".length)),
    );
    const walk = (directory: string, prefix = ""): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(join(directory, entry.name), path);
          continue;
        }
        if (!entry.isFile() || !expected.has(path))
          throw new Error(
            "Installed public package contains unexpected resources",
          );
      }
    };
    walk(root);
    for (const [path, bytes] of files) {
      const destination = join(root, path.slice("package/".length));
      if (
        !lstatSync(destination).isFile() ||
        !readFileSync(destination).equals(bytes)
      )
        throw new Error(
          "Installed public package differs from its verified archive; inspect the project before retrying",
        );
    }
  }
}
