import { type SkillEntry } from "../catalog.js";
import { find, type FindResult } from "../find.js";
import { verifiedRuntimesOf, type Runtime } from "../runtime.js";
import { matches } from "./filters.js";
export function verification(
  entry: SkillEntry | undefined,
  runtime: Runtime | null,
  asked: boolean,
) {
  if (!asked) return {};
  const verifiedRuntimes = verifiedRuntimesOf(entry?.metadata);
  return {
    ...(verifiedRuntimes.length > 0 ? { verifiedRuntimes } : {}),
    ...(runtime === null
      ? {}
      : { verified: verifiedRuntimes.includes(runtime) }),
  };
}
export function verifiedFirst<
  T extends {
    readonly verified?: boolean;
  },
>(items: readonly T[]): T[] {
  return [
    ...items.filter((item) => item.verified === true),
    ...items.filter((item) => item.verified !== true),
  ];
}
export function namedFirst(
  result: FindResult,
  entries: readonly SkillEntry[],
  intent: string,
): FindResult {
  const text = intent.toLowerCase();
  const named = entries.filter((entry) => {
    const slug = entry.slug.toLowerCase();
    if (slug.length < 4) return false;
    const at = text.indexOf(slug);
    if (at === -1) return false;
    const before = text[at - 1] ?? " ";
    const after = text[at + slug.length] ?? " ";
    return !/[a-z0-9-]/.test(before) && !/[a-z0-9-]/.test(after);
  });
  if (named.length === 0) return result;
  const top = result.matches[0]?.score ?? 1;
  const names = new Set(named.map((entry) => entry.name));
  const first = named.map((entry) => ({
    name: entry.name,
    package: entry.package,
    description: entry.description,
    score: result.matches.find((m) => m.name === entry.name)?.score ?? top,
  }));
  const rest = result.matches.filter((match) => !names.has(match.name));
  const size = Math.max(result.matches.length, first.length);
  return { ...result, matches: [...first, ...rest].slice(0, size) };
}
