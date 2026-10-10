import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { integrity, readArchive } from "./archive.mjs";
import { archiveDirectory, readCatalog, skillDirectory } from "./catalog.mjs";
import { contentDigest, readSkillFiles } from "./source.mjs";
import { validateTopics } from "./topics.mjs";
import { readManualLibrarySkills } from "./manual.mjs";

export function verifyArchive(entry, bytes, source) {
  if (integrity(bytes) !== entry.delivery.integrity)
    throw new Error("Archive integrity mismatch");
  const files = readArchive(bytes);
  const sources = [...files.keys()].filter((path) =>
    path.endsWith("/SKILL.md"),
  );
  if (sources.length !== 1)
    throw new Error("Archive requires exactly one SKILL.md");
  if (
    !/^package\/skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/SKILL\.md$/u.test(sources[0])
  )
    throw new Error("Invalid archive skill install path");
  const archiveSource = files.get(sources[0]).toString("utf8");
  if (source !== undefined && source !== archiveSource)
    throw new Error("Archive skill differs from source");
  const name = sources[0].slice("package/skills/".length, -"/SKILL.md".length);
  if (contentDigest(name, archiveSource) !== entry.contentDigest)
    throw new Error("Skill content digest mismatch");
  const manifestBytes = files.get("package/package.json");
  if (!manifestBytes || !files.get("package/LICENSE"))
    throw new Error("Archive requires a manifest and license");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (
    manifest.name !== entry.delivery.packageName ||
    manifest.version !== entry.delivery.version
  )
    throw new Error("Archive manifest identity mismatch");
  for (const field of [
    "scripts",
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
    "bin",
  ]) {
    if (field in manifest)
      throw new Error("Archive manifest must be content-only");
  }
  for (const path of files.keys()) {
    if (
      path === "package/LICENSE" ||
      path === "package/package.json" ||
      path === sources[0]
    )
      continue;
    if (
      !path.startsWith(`package/skills/${name}/references/`) ||
      !path.endsWith(".md")
    )
      throw new Error("Archive contains unexpected content");
  }
  return { files, source: archiveSource, name, manifest };
}

export function checkLibrarySkills(root) {
  const catalog = readCatalog(root);
  validateTopics(root, catalog);
  const manualPilots = readManualLibrarySkills(root, catalog);
  for (const entry of catalog.entries) {
    const directory = skillDirectory(root, entry);
    const { source, skill, files } = readSkillFiles(directory);
    const archive = verifyArchive(
      entry,
      readFileSync(join(archiveDirectory(root, entry), "package.tgz")),
      source,
    );
    if (archive.name !== skill.name)
      throw new Error("Install folder does not match the skill name");
    for (const [path, bytes] of files) {
      if (!archive.files.get(`package/${path}`)?.equals(bytes))
        throw new Error("Archive reference differs from source");
    }
    if (archive.files.size !== files.size + 2)
      throw new Error("Archive contains stale references");
  }
  const drafts = [];
  const identities = new Set(
    catalog.entries.map((entry) => `${entry.productId}/${entry.line.major}`),
  );
  for (const pilot of manualPilots) identities.add(pilot.identity);
  for (const product of readdirSync(join(root, "docs/skills"), {
    withFileTypes: true,
  })) {
    if (!product.isDirectory()) continue;
    for (const major of readdirSync(join(root, "docs/skills", product.name), {
      withFileTypes: true,
    })) {
      if (!major.isDirectory() || !/^\d+$/u.test(major.name)) continue;
      const identity = `${product.name}/${major.name}`;
      if (
        !identities.has(identity) &&
        existsSync(join(root, "docs/skills", identity, "SKILL.md"))
      )
        drafts.push(identity);
    }
  }
  const result = {
    entries: catalog.entries.length,
    revision: catalog.revision,
  };
  if (manualPilots.length) result.manualPilots = manualPilots.length;
  if (drafts.length) result.drafts = drafts.sort();
  return result;
}
