import { skillDuplicationWarnings } from "../../schema.js";
import { catalogV1 } from "./schema.js";
import type { CatalogSkill, Finding } from "./types.js";

export function skillFindings(skill: CatalogSkill): Finding[] {
  const out: Finding[] = [];
  const add = (rule: string, message: string) =>
    out.push({ rule, message, severity: "error" });
  const result = catalogV1.safeParse(skill.front);
  if (!result.success) {
    for (const issue of result.error.issues)
      add(`schema.${issue.path.join(".") || "frontmatter"}`, issue.message);
    return out;
  }
  const { name, description, metadata: m } = result.data;
  const { tier } = skill;
  for (const message of skillDuplicationWarnings(m, skill.pluginVersion))
    out.push({ rule: "duplication", message, severity: "warning" });
  if (name !== skill.dirName)
    add(
      "name.directory",
      `name must equal the directory name ${skill.dirName}`,
    );
  if (m.tier !== undefined && m.tier !== tier)
    add("tier.mismatch", `metadata.tier ${m.tier} in a ${tier} marketplace`);
  if (tier !== "internal" && /[^\x20-\x7E]/u.test(description))
    add("description.ascii", "description must be plain English ASCII");
  if (!m.approval && (tier === "paid" || skill.hasScripts))
    add("approval.required", "metadata.approval missing");
  if (tier === "open" && m.pair !== undefined)
    add("pair.tier", "metadata.pair is not allowed in the open tier");
  if (tier !== "open" && m.install === "default")
    add(
      "install.default",
      `metadata.install default is not allowed in the ${tier} tier`,
    );
  if (
    [...(m.locales ?? [])].sort().join(",") !==
    [...new Set(skill.localeFiles)].sort().join(",")
  )
    add(
      "locales.files",
      "metadata.locales does not match references/*.<locale>.md",
    );
  return out;
}
