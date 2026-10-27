import { TIERS, type Tier } from "../../schema.js";
import { catalogV1 } from "./schema.js";
import type { CatalogSkill } from "./types.js";
import { namesPattern, pairTiers } from "./_shared.js";

export function referenceFindings(
  skill: CatalogSkill,
  catalog: ReadonlyMap<string, Tier>,
): string[] {
  const parsed = catalogV1.safeParse(skill.front);
  if (!parsed.success) return [];
  const out: string[] = [];
  for (const target of parsed.data.metadata.pair ?? []) {
    const targetTier = catalog.get(target);
    if (!targetTier) {
      out.push(`metadata.pair ${target} is not in any catalog given`);
      continue;
    }
    if (!pairTiers[skill.tier].includes(targetTier))
      out.push(`metadata.pair ${target} is a ${targetTier} skill`);
  }
  for (const [name, tier] of catalog) {
    if (
      name === skill.dirName ||
      TIERS.indexOf(tier) <= TIERS.indexOf(skill.tier)
    )
      continue;
    if (namesPattern(name).test(skill.body))
      out.push(
        `body names ${name}, a ${tier} skill, from the ${skill.tier} tier`,
      );
    if (namesPattern(name).test(parsed.data.description))
      out.push(
        `description names ${name}, a ${tier} skill, from the ${skill.tier} tier`,
      );
  }
  return out;
}
export function unregisteredFindings(
  dirs: string[],
  registered: string[],
): string[] {
  return dirs
    .filter((d) => !registered.includes(d))
    .map(
      (d) =>
        `plugin directory ${d} has skills but no marketplace.json entry; register it or remove it`,
    );
}
export function trackedResultsFindings(files: string[]): string[] {
  return files
    .filter((f) => /^plugins\/[^/]+\/evals\/results\//u.test(f))
    .map(
      (f) =>
        `${f} is tracked by git; eval results stay local and are gitignored`,
    );
}
export function duplicatePluginFindings(
  names: string[],
  others: ReadonlyMap<Tier, string[]>,
): string[] {
  return names.flatMap((n) =>
    [...others]
      .filter(([, other]) => other.includes(n))
      .map(([tier]) => `plugin ${n} also exists in the ${tier} tier`),
  );
}
export function descriptionDriftFindings(input: {
  name: string;
  entry?: string;
  plugin?: string;
  gemini?: string;
}): string[] {
  const present = [input.entry, input.plugin, input.gemini].filter(
    (v) => v !== undefined,
  );
  return new Set(present).size > 1
    ? [`plugin ${input.name} descriptions differ`]
    : [];
}
export function gatedNameFindings(
  text: string,
  catalog: ReadonlyMap<string, Tier>,
  ownNames: ReadonlySet<string>,
): string[] {
  return [...catalog]
    .filter(
      ([name, tier]) =>
        tier !== "open" && !ownNames.has(name) && namesPattern(name).test(text),
    )
    .map(
      ([name, tier]) => `names ${name}, a ${tier} skill, from the open tier`,
    );
}
