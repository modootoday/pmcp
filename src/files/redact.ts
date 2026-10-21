// Redact MCP configuration because environment and header values can contain credentials.

import { basename } from "node:path";

export const REDACTED = "<redacted>";

const SECRET_MAPS = new Set(["env", "headers"]);

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    const isSecretMap =
      SECRET_MAPS.has(key.toLowerCase()) &&
      inner !== null &&
      typeof inner === "object" &&
      !Array.isArray(inner);
    out[key] = isSecretMap
      ? Object.fromEntries(Object.keys(inner).map((name) => [name, REDACTED]))
      : redactValue(inner);
  }
  return out;
}

export function redactMcpConfig(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return `${JSON.stringify({ redacted: REDACTED, reason: "not valid JSON" }, null, 2)}\n`;
  }
  return `${JSON.stringify(redactValue(parsed), null, 2)}\n`;
}

export const isMcpConfig = (path: string): boolean =>
  basename(path) === ".mcp.json";

export function servedBytes(path: string, raw: Buffer): Buffer {
  if (!isMcpConfig(path)) return raw;
  return Buffer.from(redactMcpConfig(raw.toString("utf8")), "utf8");
}
