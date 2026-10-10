/**
 * The Skills extension's methods, skills/list and skills/get. Their files are
 * served by the skill:// resources (resources.ts), which every surface shares.
 */

import {
  ProtocolError,
  ProtocolErrorCode,
  type McpServer,
} from "@modelcontextprotocol/server";
import { z } from "zod";

import type { SkillEntry } from "../catalog.js";
import { extensionEntry, type SkillExtensionEntry } from "./entry.js";

export const SKILLS_EXTENSION = "io.modelcontextprotocol/skills";

const PAGE_SIZE = 50;
const TTL_MS = 60_000;

export interface SkillsExtensionOptions {
  /**
   * "public" when every caller sees the same catalog; "private" when the list is
   * filtered per caller, as it is behind authorization.
   */
  readonly cacheScope?: "public" | "private";
}

/** Entries memoised per catalog array: the array is the same until a refresh. */
function entriesOf(skills: () => readonly SkillEntry[]) {
  let memo: {
    source: readonly SkillEntry[];
    entries: Map<string, SkillExtensionEntry>;
  } | null = null;
  return (): Map<string, SkillExtensionEntry> => {
    const source = skills();
    if (memo?.source === source) return memo.entries;
    const map = new Map<string, SkillExtensionEntry>();
    for (const entry of source) {
      try {
        const served = extensionEntry(entry);
        if (served) map.set(served.uri, served);
      } catch {
        // A skill whose files vanished since the walk is left out, not fatal.
      }
    }
    memo = { source, entries: map };
    return map;
  };
}

function page(all: readonly SkillExtensionEntry[], cursor: string | undefined) {
  const start = cursor ? Number.parseInt(cursor, 10) : 0;
  if (!Number.isInteger(start) || start < 0 || start > all.length) {
    throw new ProtocolError(ProtocolErrorCode.InvalidParams, "invalid cursor");
  }
  const end = start + PAGE_SIZE;
  return {
    skills: all.slice(start, end),
    ...(end < all.length ? { nextCursor: String(end) } : {}),
  };
}

/** Declares the extension and its methods. Must run before the server connects. */
export function registerSkillsExtension(
  server: McpServer,
  skills: () => readonly SkillEntry[],
  options: SkillsExtensionOptions = {},
): void {
  const entries = entriesOf(skills);
  const cache = { ttlMs: TTL_MS, cacheScope: options.cacheScope ?? "public" };

  server.server.registerCapabilities({
    extensions: { [SKILLS_EXTENSION]: {} },
  });

  server.server.setRequestHandler(
    "skills/list",
    { params: z.object({ cursor: z.string().optional() }).passthrough() },
    async (params) => ({
      resultType: "complete",
      ...page([...entries().values()], params.cursor),
      ...cache,
    }),
  );

  server.server.setRequestHandler(
    "skills/get",
    { params: z.object({ uri: z.string() }).passthrough() },
    async (params) => {
      const skill = entries().get(params.uri);
      if (!skill) {
        throw new ProtocolError(
          ProtocolErrorCode.InvalidParams,
          `not a skill this server serves: ${params.uri}`,
        );
      }
      return { resultType: "complete", skill, ...cache };
    },
  );
}
