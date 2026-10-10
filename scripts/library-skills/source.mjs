import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";

export function sourceDigest(source) {
  return createHash("sha256").update(source).digest("hex");
}

export function contentDigest(name, source) {
  const path = `skills/${name}/SKILL.md`;
  const framed = `${path.length}:${path}:${source.length}:${source}`;
  return `sha256:${sourceDigest(framed)}`;
}

export function parseSkill(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(
    source,
  );
  if (!match) throw new Error("SKILL.md requires YAML frontmatter");
  const document = parseDocument(match[1], { uniqueKeys: true });
  if (document.errors.length)
    throw new Error(`Invalid skill YAML: ${document.errors[0].message}`);
  const data = document.toJSON();
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("Skill frontmatter must be an object");
  if (
    typeof data.name !== "string" ||
    data.name.length > 64 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(data.name)
  )
    throw new Error("Invalid skill name");
  if (
    typeof data.description !== "string" ||
    !data.description.trim() ||
    data.description.length > 1024
  )
    throw new Error("Invalid skill description");
  if (data.license !== undefined && typeof data.license !== "string")
    throw new Error("Skill license must be a string");
  if (
    data.compatibility !== undefined &&
    (typeof data.compatibility !== "string" || data.compatibility.length > 500)
  )
    throw new Error("Invalid skill compatibility");
  if (
    data.metadata !== undefined &&
    (!data.metadata ||
      typeof data.metadata !== "object" ||
      Array.isArray(data.metadata) ||
      Object.values(data.metadata).some((value) => typeof value !== "string"))
  )
    throw new Error("Skill metadata must contain string values");
  if (match[2].split(/\r?\n/u).length > 500)
    throw new Error("Skill body exceeds 500 lines");
  return { ...data, body: match[2] };
}

export function readSkillFiles(directory) {
  const sourcePath = join(directory, "SKILL.md");
  if (!lstatSync(sourcePath).isFile() || lstatSync(sourcePath).isSymbolicLink())
    throw new Error("Skill source must be a regular file");
  const source = readFileSync(sourcePath, "utf8");
  const skill = parseSkill(source);
  const files = new Map([
    [`skills/${skill.name}/SKILL.md`, Buffer.from(source)],
  ]);
  const entries = readdirSync(directory, { withFileTypes: true });
  const references = entries.find((entry) => entry.name === "references");
  if (references) {
    if (!references.isDirectory() || references.isSymbolicLink())
      throw new Error("References must be a regular directory");
    for (const entry of readdirSync(join(directory, "references"), {
      withFileTypes: true,
    })) {
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/u.test(entry.name)
      )
        throw new Error(
          "References must contain only Markdown files without symlinks",
        );
      const bytes = readFileSync(join(directory, "references", entry.name));
      files.set(`skills/${skill.name}/references/${entry.name}`, bytes);
    }
  }
  if (files.size > 128) throw new Error("Skill contains too many references");
  return { source, skill, files };
}
