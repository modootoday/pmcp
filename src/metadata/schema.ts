import { z } from "zod";

export const TIERS = ["open", "free", "paid", "internal"] as const;
export const RUNTIMES = [
  "claude-code",
  "codex-cli",
  "gemini-cli",
  "grok-cli",
  "antigravity",
] as const;
export const tier = z.enum(TIERS);
export type Tier = z.infer<typeof tier>;
export const runtime = z.enum(RUNTIMES);
export const version = z
  .string()
  .regex(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/);
export const kebab = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const strings = z.array(z.string());
export const requires = z.looseObject({
  mcp: strings.optional(),
  bin: strings.optional(),
  env: strings.optional(),
  "gpu-gb": z.string().optional(),
  capabilities: strings.optional(),
});
export const skillMetadataCore = z
  .looseObject({
    version: version.optional(),
    keywords: strings.optional(),
    locales: z.array(z.string().regex(/^[a-z]{2}$/)).optional(),
    level: z.enum(["L1", "L2", "L3", "L4", "L5"]).optional(),
    domain: kebab.optional(),
    install: z.enum(["default", "optional", "catalog-only"]).optional(),
    requires: requires.optional(),
    provides: strings.optional(),
    approval: z.enum(["none", "scripts", "hooks"]).optional(),
    "output-license": z.string().optional(),
    pair: strings.optional(),
    "verified-runtimes": z
      .array(runtime)
      .refine((v) => new Set(v).size === v.length, "Runtime listed twice")
      .meta({
        description:
          "Generated from recorded runtime evaluations; do not author by hand.",
        readOnly: true,
        uniqueItems: true,
      })
      .optional(),
    tier: tier
      .meta({
        deprecated: true,
        description:
          "Inherited from marketplace metadata.tier; repeated skill tiers warn.",
      })
      .optional(),
  })
  .meta({
    title: "Skill metadata",
    description:
      "The metadata map of a SKILL.md frontmatter: catalog fields pmcp reads (level, domain, install, keywords and the rest).",
  });
// Titles and descriptions reach editors and agents through the generated schema/*.json.
export const skillFrontmatter = z
  .looseObject({
    name: z.string().min(1),
    description: z.string().min(1),
    license: z.string().optional(),
    compatibility: z.string().optional(),
    "allowed-tools": z.union([z.string(), strings]).optional(),
    metadata: skillMetadataCore.optional(),
  })
  .meta({
    title: "SKILL.md frontmatter",
    description:
      "The Agent Skills frontmatter pmcp validate checks: name, description and the optional fields.",
  });
const manifestFields = {
  tier: z.never().optional(),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  version: version.optional(),
  displayName: z.string().min(1).optional(),
  renames: z.record(z.string().min(1), z.string().min(1).nullable()).optional(),
  interface: z
    .looseObject({ displayName: z.string().min(1).optional() })
    .optional(),
};
export const pluginManifest = z.looseObject(manifestFields).meta({
  title: "Plugin manifest",
  description: "A native plugin manifest as pmcp reads it from a marketplace.",
});
export const marketplaceManifest = z
  .looseObject({
    ...manifestFields,
    metadata: z
      .looseObject({
        tier: tier.optional(),
        description: z.string().min(1).optional(),
        version: version.optional(),
      })
      .optional(),
    plugins: z.array(pluginManifest),
  })
  .meta({
    title: "Marketplace manifest",
    description:
      "A native plugin marketplace manifest and the plugins it lists.",
  });

export function projectPluginIdentity<T extends Record<string, unknown>>(
  native: T,
  plugin: z.infer<typeof pluginManifest>,
) {
  return {
    ...native,
    description: plugin.description,
    version: plugin.version,
  };
}
export function inheritSkillMetadata(
  metadata: z.infer<typeof skillMetadataCore>,
  marketplaceTier: Tier,
  pluginVersion?: string,
) {
  return {
    ...metadata,
    tier: marketplaceTier,
    version: metadata.version ?? pluginVersion,
  };
}
export function skillDuplicationWarnings(
  metadata: z.infer<typeof skillMetadataCore>,
  pluginVersion?: string,
) {
  const warnings: string[] = [];
  if (metadata.tier !== undefined)
    warnings.push(
      "metadata.tier is inherited from the marketplace; remove the repeated field",
    );
  if (metadata.version !== undefined && metadata.version === pluginVersion)
    warnings.push(
      "metadata.version equals the plugin version; inherit it instead",
    );
  return warnings;
}
