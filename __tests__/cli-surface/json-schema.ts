// A validator for exactly the keywords docs/commands/schemas.json uses, so a published schema
// is checked against what a command really prints; an unknown keyword fails loudly.
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Schema = Record<string, unknown>;

const KNOWN = new Set([
  "type",
  "$ref",
  "required",
  "properties",
  "items",
  "additionalProperties",
  "const",
  "enum",
  "anyOf",
  "minimum",
  "pattern",
  "description",
]);

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function typeMatches(expected: unknown, value: unknown): boolean {
  const actual = typeOf(value);
  const names = Array.isArray(expected) ? expected : [expected];
  return names.some(
    (name) => name === actual || (name === "number" && actual === "integer"),
  );
}

export function validator(document: Schema) {
  const resolve = (ref: string): Schema => {
    if (!ref.startsWith("#/")) throw new Error(`unsupported $ref ${ref}`);
    let node: unknown = document;
    for (const part of ref.slice(2).split("/"))
      node = (node as Record<string, unknown> | undefined)?.[part];
    if (!node || typeof node !== "object")
      throw new Error(`$ref not found: ${ref}`);
    return node as Schema;
  };

  const check = (schema: Schema, value: unknown, at: string): string[] => {
    for (const key of Object.keys(schema))
      if (!KNOWN.has(key))
        throw new Error(`unsupported keyword ${key} at ${at}`);
    if (typeof schema["$ref"] === "string")
      return check(resolve(schema["$ref"]), value, at);
    const problems: string[] = [];
    if ("const" in schema && value !== schema["const"])
      problems.push(`${at}: expected ${JSON.stringify(schema["const"])}`);
    if (Array.isArray(schema["enum"]) && !schema["enum"].includes(value))
      problems.push(`${at}: not one of ${JSON.stringify(schema["enum"])}`);
    if ("type" in schema && !typeMatches(schema["type"], value))
      return [
        ...problems,
        `${at}: expected ${JSON.stringify(schema["type"])}, got ${typeOf(value)}`,
      ];
    if (Array.isArray(schema["anyOf"])) {
      const options = schema["anyOf"] as Schema[];
      if (!options.some((option) => check(option, value, at).length === 0))
        problems.push(`${at}: matches none of anyOf`);
    }
    if (
      typeof schema["minimum"] === "number" &&
      typeof value === "number" &&
      value < schema["minimum"]
    )
      problems.push(`${at}: below ${schema["minimum"]}`);
    if (
      typeof schema["pattern"] === "string" &&
      typeof value === "string" &&
      !new RegExp(schema["pattern"], "u").test(value)
    )
      problems.push(`${at}: does not match ${schema["pattern"]}`);
    if (Array.isArray(value) && schema["items"])
      value.forEach((item, index) =>
        problems.push(
          ...check(schema["items"] as Schema, item, `${at}[${index}]`),
        ),
      );
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const properties = (schema["properties"] ?? {}) as Record<string, Schema>;
      for (const key of (schema["required"] ?? []) as string[])
        if (!(key in record)) problems.push(`${at}: missing ${key}`);
      for (const [key, item] of Object.entries(record)) {
        if (properties[key]) {
          problems.push(...check(properties[key], item, `${at}.${key}`));
          continue;
        }
        const extra = schema["additionalProperties"];
        if (extra === false) problems.push(`${at}: unexpected ${key}`);
        else if (extra && typeof extra === "object")
          problems.push(...check(extra as Schema, item, `${at}.${key}`));
      }
    }
    return problems;
  };

  return (name: string, value: unknown): string[] =>
    check(resolve(`#/schemas/${name}`), value, name);
}

export function publishedDocument(): Schema {
  return JSON.parse(
    readFileSync(
      join(import.meta.dirname, "../../docs/commands/schemas.json"),
      "utf8",
    ),
  ) as Schema;
}

export const validatePublished = validator(publishedDocument());
