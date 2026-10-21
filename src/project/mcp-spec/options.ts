import { TOOLS, type Tool } from "../spec.js";
import { ENV_NAME, fail, object } from "./_shared.js";

export function nativeOptions(
  path: string,
  where: string,
  value: unknown,
): Partial<Record<Tool, Record<string, number>>> {
  const fields: Record<Tool, readonly string[]> = {
    claude: ["timeout"],
    codex: ["startup_timeout_sec", "tool_timeout_sec"],
    gemini: ["timeout"],
    grok: ["startup_timeout_sec", "tool_timeout_sec"],
    antigravity: [],
    opencode: ["timeout"],
  };
  const result: Partial<Record<Tool, Record<string, number>>> = {};
  for (const [tool, raw] of Object.entries(
    object(path, `${where} native`, value),
  )) {
    if (!(TOOLS as readonly string[]).includes(tool)) {
      fail(path, where, `unknown native target ${tool}`);
    }
    const values: Record<string, number> = {};
    for (const [key, item] of Object.entries(
      object(path, `${where} native.${tool}`, raw),
    )) {
      if (
        !fields[tool as Tool].includes(key) ||
        typeof item !== "number" ||
        !Number.isFinite(item) ||
        item <= 0
      ) {
        fail(path, where, `unsupported native option ${tool}.${key}`);
      }
      values[key] = item;
    }
    result[tool as Tool] = values;
  }
  return result;
}

export function environmentSources(
  path: string,
  where: string,
  value: unknown,
): Record<string, { file: string; pointer: string }> {
  const result: Record<string, { file: string; pointer: string }> = {};
  for (const [key, raw] of Object.entries(
    object(path, `${where} env_from`, value),
  )) {
    if (!ENV_NAME.test(key) || key === "PROJECT_ROOT") {
      fail(path, where, "invalid environment source name");
    }
    const source = object(path, `${where} env_from.${key}`, raw);
    if (
      Object.keys(source).some((name) => name !== "file" && name !== "pointer")
    ) {
      fail(path, where, "environment sources accept only file and pointer");
    }
    if (
      typeof source["file"] !== "string" ||
      source["file"] === "" ||
      typeof source["pointer"] !== "string" ||
      !source["pointer"].startsWith("/")
    ) {
      fail(path, where, "environment source needs file and a JSON pointer");
    }
    result[key] = { file: source["file"], pointer: source["pointer"] };
  }
  return result;
}
