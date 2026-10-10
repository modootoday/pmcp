/**
 * Agent runtimes a skill can declare itself verified on, and the mapping from
 * an MCP client's reported name to one of them.
 */

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

/** The runtimes a metadata block lists as verified; unknown values are dropped. */
export function verifiedRuntimesOf(
  metadata: Readonly<Record<string, MetadataValue>> | undefined,
): Runtime[] {
  const raw = metadata?.[VERIFIED_RUNTIMES_KEY];
  if (raw === undefined) return [];
  const words =
    typeof raw === "string"
      ? raw.split(/[\s,]+/u)
      : Array.isArray(raw)
        ? raw.map((word) => String(word).trim())
        : [];
  return [...new Set(words.filter(isRuntime))];
}

const CLIENT_PATTERNS: readonly (readonly [RegExp, Runtime])[] = [
  [/claude[-_ ]?code/u, "claude-code"],
  [/codex/u, "codex-cli"],
  [/gemini/u, "gemini-cli"],
  [/grok/u, "grok-cli"],
  [/antigravity/u, "antigravity"],
];

/** The runtime an MCP client name stands for; null when it is not recognised. */
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

/**
 * The runtime of the client making this request. The per-request envelope is
 * read first, then the initialize-scoped identity; a stateless caller has
 * neither and gets null.
 */
export function detectRuntime(
  server: ClientSource,
  ctx?: RequestContext,
): Runtime | null {
  const envelope = ctx?.mcpReq?.envelope as
    Record<string, { name?: unknown } | undefined> | undefined;
  const fromEnvelope = envelope?.[CLIENT_INFO_META_KEY]?.name;
  if (typeof fromEnvelope === "string") return runtimeOfClient(fromEnvelope);
  return runtimeOfClient(server.server?.getClientVersion?.()?.name);
}
