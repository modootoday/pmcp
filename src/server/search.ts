import { DEFAULT_FIND_LIMIT, find } from "../find.js";
import { type Runtime } from "../runtime.js";
import type { FindResponse } from "../tools/schemas.js";
import type { SkillFilters } from "./types.js";
import type { ToolsContext } from "./types.js";
import { matches } from "./filters.js";
import { verification } from "./ranking.js";
import { verifiedFirst } from "./ranking.js";
import { namedFirst } from "./ranking.js";
export function findOperation(
  context: ToolsContext,
  intent: string,
  limit?: number,
  filters?: SkillFilters,
  clientRuntime?: Runtime | null,
): Promise<FindResponse> {
  const { options, catalog, byName } = context;
  const client = options.rankByClientRuntime ? clientRuntime : null;
  const runtime = filters?.runtime ?? client ?? null;
  const asked = runtime !== null || filters?.verifiedOnly !== undefined;
  const scoped = catalog()
    .filter((entry) => matches(entry, filters))
    .map((entry) =>
      entry.keywords && entry.keywords.length > 0
        ? {
            ...entry,
            description: `${entry.description} ${entry.keywords.join(" ")}`,
          }
        : entry,
    );
  return find({
    entries: scoped,
    intent,
    limit: runtime === null ? limit : scoped.length,
    embedder: options.embedder,
    cache: options.cache,
    vectors: options.vectors,
  }).then((ranked) => {
    const result = namedFirst(ranked, scoped, intent);
    const marked = result.matches.map((match) => {
      const entry = byName(match.name) ?? undefined;
      return {
        ...match,
        description: entry?.description ?? match.description,
        ...verification(entry, runtime, asked),
      };
    });
    const ordered = runtime === null ? marked : verifiedFirst(marked);
    return {
      ...result,
      ...(asked ? { runtime } : {}),
      matches:
        runtime === null
          ? ordered
          : ordered.slice(0, limit ?? DEFAULT_FIND_LIMIT),
    };
  });
}
