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
  const { tier, body } = skill;
  for (const message of skillDuplicationWarnings(m, skill.pluginVersion))
    out.push({ rule: "duplication", message, severity: "warning" });
  if (name !== skill.dirName)
    add(
      "name.directory",
      `name must equal the directory name ${skill.dirName}`,
    );
  if (m.tier !== undefined && m.tier !== tier)
    add("tier.mismatch", `metadata.tier ${m.tier} in a ${tier} marketplace`);
  if (tier !== "internal") {
    if (/[^\x20-\x7E]/u.test(description))
      add("description.ascii", "description must be plain English ASCII");
    if (!/\bUse (?:when|whenever|before|after|for)\b/u.test(description))
      add(
        "description.trigger",
        'description should say when to use it ("Use when ...")',
      );
  }
  if (tier === "open" && m.keywords?.some((k) => /[^\x20-\x7E]/u.test(k)))
    add("keywords.ascii", "metadata.keywords must be English in the open tier");
  if (
    !m["output-license"] &&
    (tier === "paid" ||
      ((tier === "open" || tier === "free") && m.domain.startsWith("asset")))
  )
    add("output-license.required", "metadata.output-license missing");
  if (!m.approval && (tier === "paid" || skill.hasScripts))
    add("approval.required", "metadata.approval missing");
  if (tier === "open" && m.pair !== undefined)
    add("pair.tier", "metadata.pair is not allowed in the open tier");
  if (tier !== "paid" && m["server-tools"] !== undefined)
    add(
      "server-tools.forbidden",
      `metadata.server-tools is not allowed in the ${tier} tier`,
    );
  if (tier === "paid") {
    if (!m["server-tools"]?.length)
      add("server-tools.required", "metadata.server-tools missing");
    if (
      body.includes("job_submit") &&
      (!body.includes("job_estimate") ||
        body.indexOf("job_estimate") > body.indexOf("job_submit"))
    )
      add(
        "server-tools.order",
        "job_estimate must come before job_submit in the body",
      );
  }
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
