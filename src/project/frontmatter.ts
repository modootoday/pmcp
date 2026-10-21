import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface Document {
  readonly meta: Record<string, unknown>;
  readonly body: string;
}

export function splitFrontmatter(source: string): Document {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/u.exec(source);
  if (!match) return { meta: {}, body: source };
  // Load YAML only for documents with frontmatter so empty projection checks stay cheap.
  const { parse } = require("yaml") as typeof import("yaml");
  const meta: unknown = parse(match[1] ?? "");
  const object =
    meta !== null && typeof meta === "object" && !Array.isArray(meta)
      ? (meta as Record<string, unknown>)
      : {};
  return { meta: object, body: match[2] ?? "" };
}

function scalar(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function renderFrontmatter(
  meta: Readonly<Record<string, unknown>>,
): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.includes("\n")) {
      const block = value
        .replace(/\n$/u, "")
        .split("\n")
        .map((line) => `  ${line}`);
      lines.push(`${key}: |`, ...block);
      continue;
    }
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => JSON.stringify(v)).join(", ")}]`);
      continue;
    }
    lines.push(`${key}: ${scalar(value)}`);
  }
  return `---\n${lines.join("\n")}\n---\n`;
}
