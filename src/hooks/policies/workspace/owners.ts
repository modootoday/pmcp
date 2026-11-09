import { isAbsolute, relative, resolve } from "node:path";

import {
  ownerLine,
  ownersOf,
  readOwners,
  type OwnerEntry,
} from "../../owners.js";
import type { HookInput } from "../../contract.js";
import { onlyKeys, pass, type Policy, type PolicyContext } from "../types.js";

interface Options {
  readonly entries: readonly OwnerEntry[];
}

function projectPaths(input: HookInput): string[] {
  const found: string[] = [];
  for (const path of input.tool?.paths ?? []) {
    const rest = relative(input.projectRoot, resolve(input.cwd, path));
    if (rest === "" || rest.startsWith("..") || isAbsolute(rest)) continue;
    found.push(rest.split("\\").join("/"));
  }
  return found;
}

// Each owner is named once per session, so editing many of its files is one notice.
function noticed(input: HookInput, ctx: PolicyContext<Options>): string[] {
  try {
    const raw = ctx.store.registry.get(input.session.id)?.["owners"];
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function remember(
  input: HookInput,
  ctx: PolicyContext<Options>,
  owners: readonly string[],
): void {
  try {
    ctx.store.registry.upsert(input.session.id, { owners: [...owners] });
  } catch (error) {
    ctx.log.error("owners notice not recorded", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export const owners: Policy<Options> = {
  id: "owners",
  events: ["after_tool"],
  tools: ["edit"],
  fail: "open",
  defaultMode: "warn",
  options(raw) {
    onlyKeys(raw, ["entries"]);
    return { entries: readOwners(raw["entries"]) };
  },
  evaluate(input, ctx) {
    const seen = noticed(input, ctx);
    const lines: string[] = [];
    const told = new Set(seen);
    for (const path of projectPaths(input))
      for (const entry of ownersOf(ctx.options.entries, path)) {
        if (entry.mode === "observe") {
          ctx.log.info("owned path edited", { owner: entry.owner });
          continue;
        }
        if (told.has(entry.owner)) continue;
        told.add(entry.owner);
        lines.push(`pmcp owners: ${ownerLine(entry, path)}`);
      }
    if (lines.length === 0) return pass;
    remember(input, ctx, [...told]);
    return { context: lines };
  },
};
