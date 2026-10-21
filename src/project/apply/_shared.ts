import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";

import { ProjectError } from "../package-rules.js";

const BEGIN = "# >>> pmcp project (edit pmcp.toml, not this block) >>>";
const END = "# <<< pmcp project <<<";

export function linkOf(abs: string): string | null {
  try {
    return lstatSync(abs).isSymbolicLink() ? readlinkSync(abs) : null;
  } catch {
    return null;
  }
}

export const exists = (abs: string) => existsSync(abs) || linkOf(abs) !== null;

export function fingerprint(abs: string): string {
  if (!existsSync(abs)) return "absent";
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

// Compare against the plan's snapshot so a concurrent native edit is never overwritten.
export function changedSincePlan(
  root: string,
  basis: ReadonlyMap<string, string>,
): string[] {
  return [...basis]
    .filter(([file, planned]) => fingerprint(join(root, file)) !== planned)
    .map(([file]) => `${file} changed since the plan; run pmcp project again`);
}

export function readJson(abs: string): Record<string, unknown> {
  if (!existsSync(abs)) return {};
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(abs, "utf8"));
  } catch {
    throw new ProjectError(
      "Cannot parse native JSON configuration; contents are redacted",
    );
  }
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function getKey(object: unknown, key: readonly string[]): unknown {
  let node = object;
  for (const part of key) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

export function setKey(
  object: Record<string, unknown>,
  key: readonly string[],
  value: unknown,
): void {
  let node = object;
  for (const part of key.slice(0, -1)) {
    const next = node[part];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      node[part] = {};
    }
    node = node[part] as Record<string, unknown>;
  }
  node[key[key.length - 1] ?? ""] = value;
}

export function deleteKey(
  object: Record<string, unknown>,
  key: readonly string[],
): void {
  const [head, ...rest] = key;
  if (head === undefined || !(head in object)) return;
  if (rest.length === 0) {
    delete object[head];
    return;
  }
  const child = object[head];
  if (child === null || typeof child !== "object") return;
  deleteKey(child as Record<string, unknown>, rest);
  if (Object.keys(child).length === 0) delete object[head];
}

export const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

export const block = (content: string) => `${BEGIN}\n${content}${END}\n`;

export function withoutBlock(text: string): string {
  const start = text.indexOf(BEGIN);
  if (start === -1) return text;
  const end = text.indexOf(END, start);
  if (end === -1) return text;
  const after = text.slice(end + END.length).replace(/^\n/u, "");
  return `${text.slice(0, start).replace(/\n+$/u, "\n")}${after}`;
}
