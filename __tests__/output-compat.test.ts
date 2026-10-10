import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ASSET_KINDS, type SkillEntry } from "../src/catalog.js";
import { createSkillTools } from "../src/server.js";
import {
  catalogResponseSchema,
  describeResponseSchema,
  findResultSchema,
} from "../src/tools/schemas.js";

// The 0.8.3 output schemas as clients cached them: closed objects (additionalProperties false).
const kind = z.enum(ASSET_KINDS);
const v083 = {
  catalog: z.strictObject({
    count: z.number().int(),
    page: z.number().int(),
    totalPages: z.number().int(),
    hasNext: z.boolean(),
    packages: z.array(
      z.strictObject({
        package: z.string(),
        skills: z.array(
          z.strictObject({
            name: z.string(),
            description: z.string(),
            tier: z.string().optional(),
            kind: kind.optional(),
          }),
        ),
      }),
    ),
  }),
  find: z.strictObject({
    ranking: z.enum(["semantic", "lexical"]),
    matches: z.array(
      z.strictObject({
        name: z.string(),
        package: z.string(),
        description: z.string(),
        score: z.number(),
      }),
    ),
  }),
  describe: z.strictObject({
    name: z.string(),
    kind,
    package: z.string(),
    description: z.string(),
    tier: z.string().optional(),
    metadata: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
    frontmatter: z.string(),
    files: z.array(
      z.strictObject({
        path: z.string(),
        bytes: z.number().int(),
        sha256: z.string(),
      }),
    ),
    filesTruncated: z.boolean(),
  }),
};

const entries: SkillEntry[] = [
  {
    name: "@acme/pack/deploy",
    package: "@acme/pack",
    slug: "deploy",
    description: "Deploy the stage runner to production",
    path: import.meta.filename,
    metadata: {
      "verified-runtimes": ["claude-code", "codex-cli"],
      requires: { mcp: ["skills"], "gpu-gb": "24" },
    },
  },
];
const tools = (rankByClientRuntime = false) =>
  createSkillTools({
    roots: [],
    loadCatalog: () => entries,
    rankByClientRuntime,
  });

describe("answers to calls without the 0.9 inputs fit the 0.8.3 output schemas", () => {
  it("skill_catalog", () => {
    expect(v083.catalog.safeParse(tools().catalog()).success).toBe(true);
    expect(
      v083.catalog.safeParse(tools().catalog({ clientRuntime: "codex-cli" }))
        .success,
    ).toBe(true);
  });

  it("skill_find, with or without a recognised client on a default server", async () => {
    const plain = await tools().find("deploy the stage runner");
    expect(v083.find.safeParse(plain).success).toBe(true);
    const detected = await tools().find(
      "deploy the stage runner",
      5,
      undefined,
      "codex-cli",
    );
    expect(v083.find.safeParse(detected).success).toBe(true);
  });

  it("skill_describe flattens nested metadata into dotted keys", () => {
    const answer = tools().describe("@acme/pack/deploy");
    expect(v083.describe.safeParse(answer).success).toBe(true);
    expect(answer?.metadata).toMatchObject({
      "requires.mcp": ["skills"],
      "requires.gpu-gb": "24",
    });
  });
});

describe("output schemas are open to additional properties", () => {
  it.each([
    ["catalog", catalogResponseSchema],
    ["find", findResultSchema],
    ["describe", describeResponseSchema],
  ])("%s never declares additionalProperties false", (_, schema) => {
    const json = JSON.stringify(z.toJSONSchema(schema, { io: "output" }));
    expect(json).not.toContain('"additionalProperties":false');
  });
});
