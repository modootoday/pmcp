import { CLIENT_INFO_META_KEY } from "@modelcontextprotocol/server";

import type { MetadataValue } from "./frontmatter.js";

export const RUNTIMES = [
  "claude-code",
  "codex-cli",
  "gemini-cli",
  "grok-cli",
  "antigravity",
] as const;

export type Runtime = (typeof RUNTIMES)[number];

export const VERIFIED_RUNTIMES_KEY = "verified-runtimes";

const isRuntime = (value: string): value is Runtime =>
  (RUNTIMES as readonly string[]).includes(value);

function verifiedWords(raw: unknown): string[] {
  if (typeof raw === "string") return raw.split(/[\s,]+/u);
  if (Array.isArray(raw)) return raw.map((word) => String(word).trim());
  return [];
}

export function verifiedRuntimesOf(
  metadata: Readonly<Record<string, MetadataValue>> | undefined,
): Runtime[] {
  const raw = metadata?.[VERIFIED_RUNTIMES_KEY];
  if (raw === undefined) return [];
  const words = verifiedWords(raw);
  return [...new Set(words.filter(isRuntime))];
}

const CLIENT_PATTERNS: readonly (readonly [RegExp, Runtime])[] = [
  [/claude[-_ ]?code/u, "claude-code"],
  [/codex/u, "codex-cli"],
  [/gemini/u, "gemini-cli"],
  [/grok/u, "grok-cli"],
  [/antigravity/u, "antigravity"],
];

export function runtimeOfClient(name: string | undefined): Runtime | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  for (const [pattern, runtime] of CLIENT_PATTERNS)
    if (pattern.test(lower)) return runtime;
  return null;
}

interface ClientSource {
  readonly server?: {
    getClientVersion?: () => { readonly name?: string } | undefined;
  };
}

interface RequestContext {
  readonly mcpReq?: { readonly envelope?: object };
}

// Prefer per-request identity so stateless requests do not inherit the wrong client runtime.
export function detectRuntime(
  server: ClientSource,
  ctx?: RequestContext,
): Runtime | null {
  const envelope = ctx?.mcpReq?.envelope as
    | Record<string, { name?: unknown } | undefined>
    | undefined;
  const fromEnvelope = envelope?.[CLIENT_INFO_META_KEY]?.name;
  if (typeof fromEnvelope === "string") return runtimeOfClient(fromEnvelope);
  return runtimeOfClient(server.server?.getClientVersion?.()?.name);
}
