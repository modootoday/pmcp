/**
 * SKILL.md frontmatter, read as YAML the way a host reads it, and checked against
 * the Agent Skills specification (https://agentskills.io/specification).
 */

import { parse } from "yaml";

export type MetadataLeaf = string | readonly string[];

/** A metadata value: a leaf, or a map of leaves one level below the metadata key. */
export type MetadataValue =
  MetadataLeaf | { readonly [key: string]: MetadataLeaf };

/** The frontmatter text between the fences, BOM and CRLF tolerated; null when absent. */
export function frontmatterText(source: string): string | null {
  const text = source.replace(/^﻿/u, "").replace(/\r\n/gu, "\n");
  if (!text.startsWith("---\n") && text !== "---") return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  return text.slice(4, end + 1);
}

/** The body after the frontmatter, or the whole file when there is none. */
export function bodyOf(source: string): string {
  const text = source.replace(/^﻿/u, "").replace(/\r\n/gu, "\n");
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return text;
  return text.slice(end + 4).replace(/^\n+/u, "");
}

const asObject = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Parsed frontmatter. A value with an unquoted ": " is a common authoring slip
 * the client guide says to recover from by quoting it, so that is retried once.
 */
export function frontmatterObject(
  source: string,
): Record<string, unknown> | null {
  const text = frontmatterText(source);
  if (text === null) return null;
  try {
    return asObject(parse(text));
  } catch {
    const quoted = text
      .split("\n")
      .map((line) => {
        const match = /^([A-Za-z][\w-]*):\s+(.*:\s.*)$/u.exec(line);
        if (!match || /^["'|>[{]/u.test(match[2] ?? "")) return line;
        return `${match[1]}: ${JSON.stringify(match[2])}`;
      })
      .join("\n");
    try {
      return asObject(parse(quoted));
    } catch {
      return null;
    }
  }
}

/** Top-level scalar fields as strings; folded and block scalars arrive unfolded. */
export function stringFields(
  front: Record<string, unknown> | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(front ?? {})) {
    if (typeof value === "string") out[key] = value.trim();
    else if (typeof value === "number" || typeof value === "boolean")
      out[key] = String(value);
  }
  return out;
}

function leafOf(value: unknown): MetadataLeaf | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value))
    return value.filter((v): v is string => typeof v === "string");
  return undefined;
}

/**
 * The metadata map: strings, string lists, and maps of those one level down
 * (`requires:`). Anything nested deeper is dropped.
 */
export function metadataOf(
  front: Record<string, unknown> | null,
): Record<string, MetadataValue> {
  const out: Record<string, MetadataValue> = {};
  const meta = asObject(front?.["metadata"]);
  for (const [key, value] of Object.entries(meta ?? {})) {
    const leaf = leafOf(value);
    if (leaf !== undefined) {
      out[key] = leaf;
      continue;
    }
    const nested = asObject(value);
    if (nested === null) continue;
    const map: Record<string, MetadataLeaf> = {};
    for (const [inner, innerValue] of Object.entries(nested)) {
      const innerLeaf = leafOf(innerValue);
      if (innerLeaf !== undefined) map[inner] = innerLeaf;
    }
    if (Object.keys(map).length > 0) out[key] = map;
  }
  return out;
}

const SKILL_NAME = /^[a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9]$|^[a-z0-9]$/u;
export const NAME_MAX = 64;
export const DESCRIPTION_MAX = 1024;
export const COMPATIBILITY_MAX = 500;

/**
 * What the specification requires of one SKILL.md, as messages; empty when valid.
 * directory is the name of the folder holding it.
 */
export function specProblems(
  front: Record<string, unknown> | null,
  directory: string,
): string[] {
  if (front === null) return ["frontmatter is missing or is not YAML"];
  const problems: string[] = [];
  const name = front["name"];
  if (typeof name !== "string" || name === "") {
    problems.push("name is required");
  } else {
    if (name.length > NAME_MAX)
      problems.push(`name is longer than ${NAME_MAX} characters`);
    if (!SKILL_NAME.test(name))
      problems.push(
        "name must be lowercase letters, digits and single hyphens, not starting or ending with one",
      );
    if (name !== directory)
      problems.push(`name ${name} does not match its directory ${directory}`);
  }
  const description = front["description"];
  if (typeof description !== "string" || description.trim() === "") {
    problems.push("description is required");
  } else if (description.length > DESCRIPTION_MAX) {
    problems.push(`description is longer than ${DESCRIPTION_MAX} characters`);
  }
  const compatibility = front["compatibility"];
  if (compatibility !== undefined) {
    if (typeof compatibility !== "string")
      problems.push("compatibility must be a string");
    else if (compatibility.length > COMPATIBILITY_MAX)
      problems.push(
        `compatibility is longer than ${COMPATIBILITY_MAX} characters`,
      );
  }
  const license = front["license"];
  if (license !== undefined && typeof license !== "string")
    problems.push("license must be a string");
  const allowed = front["allowed-tools"];
  if (allowed !== undefined && typeof allowed !== "string")
    problems.push("allowed-tools must be a space-separated string");
  const metadata = front["metadata"];
  if (metadata !== undefined && asObject(metadata) === null)
    problems.push("metadata must be a map");
  return problems;
}
