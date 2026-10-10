import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import semver from "semver";
import { bodyOf, frontmatterObject } from "../../src/frontmatter.ts";
import { createArchive, integrity } from "./archive.mjs";
import { readCatalog, skillDirectory, validateCatalog } from "./catalog.mjs";
import { verifyArchive } from "./check.mjs";
import { verifyEvidence } from "./evidence.mjs";
import { contentDigest, readSkillFiles } from "./source.mjs";
import { validateTopics } from "./topics.mjs";

function immutableRelease(directory, version, bytes) {
  const releases = join(directory, "releases");
  if (
    existsSync(releases) &&
    (!lstatSync(releases).isDirectory() || lstatSync(releases).isSymbolicLink())
  )
    throw new Error("Release directory must be a regular directory");
  const path = join(releases, `${version}.tgz`);
  if (
    existsSync(path) &&
    (!lstatSync(path).isFile() ||
      lstatSync(path).isSymbolicLink() ||
      !readFileSync(path).equals(bytes))
  )
    throw new Error("Published delivery versions are immutable");
  return path;
}

function metadataOnlyEvidence(previous, previousArchive, current) {
  if (!previous)
    throw new Error("Metadata-only repackaging requires an existing entry");
  if (
    JSON.stringify(previous.targets) !== JSON.stringify(current.entry.targets)
  )
    throw new Error("Metadata-only repackaging cannot change verified targets");
  const old = frontmatterObject(previousArchive.source);
  if (
    !old ||
    JSON.stringify(old) !== JSON.stringify(frontmatterObject(current.source)) ||
    bodyOf(previousArchive.source) !== bodyOf(current.source)
  )
    throw new Error(
      "Metadata-only repackaging cannot change skill semantics or body",
    );
  const oldReferences = [...previousArchive.files.keys()].filter((path) =>
    path.includes("/references/"),
  );
  const references = [...current.files.keys()].filter((path) =>
    path.includes("/references/"),
  );
  if (
    oldReferences.length !== references.length ||
    references.some(
      (path) =>
        !previousArchive.files
          .get(`package/${path}`)
          ?.equals(current.files.get(path)),
    )
  )
    throw new Error("Metadata-only repackaging cannot change references");
  return previous.evidence;
}

export function preparePublication(root, metadata, evidence) {
  if (!Array.isArray(metadata.entries) || !metadata.entries.length)
    throw new Error("Select at least one skill line");
  const catalog = readCatalog(root);
  const entries = structuredClone(catalog.entries);
  const selections = new Set();
  const writes = [];
  const license = readFileSync(join(root, "LICENSE"));
  for (const selection of metadata.entries) {
    const provisional = {
      ...selection,
      line: { major: selection.major, status: selection.status ?? "active" },
    };
    const directory = skillDirectory(root, provisional);
    const identity = `${selection.productId}/${selection.major}`;
    if (selections.has(identity))
      throw new Error("Duplicate selected skill line");
    selections.add(identity);
    const previousIndex = entries.findIndex(
      (entry) =>
        entry.productId === selection.productId &&
        entry.line.major === selection.major,
    );
    const previous = previousIndex >= 0 ? entries[previousIndex] : undefined;
    if (!selection.status && previous)
      provisional.line.status = previous.line.status;
    const { source, skill, files } = readSkillFiles(directory);
    let previousBytes;
    let previousArchive;
    if (previous) {
      previousBytes = readFileSync(join(directory, "package.tgz"));
      previousArchive = verifyArchive(previous, previousBytes);
      if (!semver.gt(selection.delivery?.version, previous.delivery.version))
        throw new Error("Updated skill requires a newer delivery version");
    }
    if (!semver.valid(selection.delivery?.version))
      throw new Error("Invalid delivery version");
    if (
      catalog.entries.some(
        (entry) =>
          entry.delivery.packageName === selection.delivery.packageName &&
          entry.delivery.version === selection.delivery.version,
      )
    )
      throw new Error("Delivery version has already been published");
    const revision =
      Math.max(
        0,
        ...entries
          .filter((entry) => entry.productId === selection.productId)
          .map((entry) => entry.skillRevision),
      ) + 1;
    const entry = {
      productId: selection.productId,
      title: selection.title,
      summary: selection.summary,
      delivery: { ...selection.delivery },
      skillRevision: revision,
      contentDigest: contentDigest(skill.name, source),
      targets: selection.targets,
      line: provisional.line,
    };
    const current = { source, files, entry };
    if (selection.repackageMetadataOnly === true) {
      entry.evidence = metadataOnlyEvidence(previous, previousArchive, current);
      if (previous.preview) entry.preview = previous.preview;
    } else {
      entry.evidence = verifyEvidence(
        evidence?.entries?.[identity],
        entry,
        source,
      );
      if (selection.preview) entry.preview = selection.preview;
    }
    const manifest = {
      name: entry.delivery.packageName,
      version: entry.delivery.version,
      description: skill.description,
      license: "SEE LICENSE IN LICENSE",
      files: ["skills", "LICENSE"],
    };
    const members = new Map(
      [...files].map(([path, bytes]) => [`package/${path}`, bytes]),
    );
    members.set("package/LICENSE", license);
    members.set(
      "package/package.json",
      Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
    );
    const bytes = createArchive(members);
    entry.delivery.integrity = integrity(bytes);
    verifyArchive(entry, bytes, source);
    if (previous)
      writes.push({
        path: immutableRelease(
          directory,
          previous.delivery.version,
          previousBytes,
        ),
        bytes: previousBytes,
        immutable: true,
      });
    writes.push({
      path: immutableRelease(directory, entry.delivery.version, bytes),
      bytes,
      immutable: true,
    });
    writes.push({ path: join(directory, "package.tgz"), bytes });
    if (previousIndex >= 0) entries[previousIndex] = entry;
    if (previousIndex < 0) entries.push(entry);
  }
  const updated = {
    ...catalog,
    revision: metadata.revision,
    publishedAt: metadata.publishedAt,
    entries,
  };
  validateCatalog(updated);
  validateTopics(root, updated);
  if (updated.revision === catalog.revision)
    throw new Error("Catalog revision must change");
  writes.push({
    path: join(root, "docs/catalog.json"),
    bytes: Buffer.from(`${JSON.stringify(updated, null, 2)}\n`),
  });
  return { catalog: updated, writes, selected: [...selections] };
}

export function writePublication(prepared) {
  for (const write of prepared.writes) {
    mkdirSync(join(write.path, ".."), { recursive: true });
    if (write.immutable) {
      if (existsSync(write.path)) {
        if (
          !lstatSync(write.path).isFile() ||
          lstatSync(write.path).isSymbolicLink() ||
          !readFileSync(write.path).equals(write.bytes)
        )
          throw new Error("Published delivery versions are immutable");
        continue;
      }
      writeFileSync(write.path, write.bytes, { flag: "wx" });
      continue;
    }
    const temporary = `${write.path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, write.bytes, { flag: "wx" });
    renameSync(temporary, write.path);
  }
  return { selected: prepared.selected, revision: prepared.catalog.revision };
}
