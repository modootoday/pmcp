import { describe, expect, it } from "vitest";

import type { SkillEntry } from "../src/catalog.js";
import { registerSkillTools } from "../src/mcp.js";
import {
  detectRuntime,
  runtimeOfClient,
  verifiedRuntimesOf,
} from "../src/runtime.js";
import { createSkillTools } from "../src/server.js";
import {
  catalogResponseSchema,
  describeResponseSchema,
  findResultSchema,
} from "../src/tools/schemas.js";

const entry = (
  slug: string,
  metadata?: SkillEntry["metadata"],
): SkillEntry => ({
  name: `@acme/pack/${slug}`,
  package: "@acme/pack",
  slug,
  description: "Deploy the stage runner to production",
  path: `/nowhere/${slug}/SKILL.md`,
  ...(metadata ? { metadata } : {}),
});

const entries = [
  entry("bogus", { "verified-runtimes": ["vim", "claude-code"] }),
  entry("both", { "verified-runtimes": ["claude-code", "codex-cli"] }),
  entry("codex-only", { "verified-runtimes": ["codex-cli"] }),
  entry("plain"),
];
const tools = () => createSkillTools({ roots: [], loadCatalog: () => entries });
const ranking = () =>
  createSkillTools({
    roots: [],
    loadCatalog: () => entries,
    rankByClientRuntime: true,
  });
const names = (matches: readonly { name: string }[]) =>
  matches.map((match) => match.name.split("/")[2]);

describe("verifiedRuntimesOf", () => {
  it("reads a list, a comma string, and drops unknown runtimes", () => {
    expect(
      verifiedRuntimesOf({ "verified-runtimes": ["grok-cli", "x"] }),
    ).toEqual(["grok-cli"]);
    expect(
      verifiedRuntimesOf({ "verified-runtimes": "claude-code, gemini-cli" }),
    ).toEqual(["claude-code", "gemini-cli"]);
    expect(verifiedRuntimesOf({ "verified-runtimes": { a: "b" } })).toEqual([]);
    expect(verifiedRuntimesOf(undefined)).toEqual([]);
  });
});

describe("runtimeOfClient", () => {
  it.each([
    ["claude-code", "claude-code"],
    ["Claude Code", "claude-code"],
    ["codex-mcp-client", "codex-cli"],
    ["gemini-cli-mcp-client", "gemini-cli"],
    ["grok-cli", "grok-cli"],
    ["Antigravity", "antigravity"],
  ])("maps %s to %s", (name, runtime) => {
    expect(runtimeOfClient(name)).toBe(runtime);
  });

  it("answers null for an unknown or missing name", () => {
    expect(runtimeOfClient("some-ide")).toBeNull();
    expect(runtimeOfClient("")).toBeNull();
    expect(runtimeOfClient(undefined)).toBeNull();
  });
});

describe("detectRuntime", () => {
  it("reads the initialize identity", () => {
    const server = {
      server: { getClientVersion: () => ({ name: "codex-mcp-client" }) },
    };
    expect(detectRuntime(server)).toBe("codex-cli");
  });

  it("prefers the per-request envelope", () => {
    const server = {
      server: { getClientVersion: () => ({ name: "codex-mcp-client" }) },
    };
    const ctx = {
      mcpReq: {
        envelope: {
          "io.modelcontextprotocol/clientInfo": { name: "gemini-cli" },
        },
      },
    };
    expect(detectRuntime(server, ctx)).toBe("gemini-cli");
  });

  it("is null for a stateless caller", () => {
    expect(detectRuntime({})).toBeNull();
    expect(
      detectRuntime({ server: { getClientVersion: () => undefined } }),
    ).toBeNull();
  });
});

describe("skill_catalog verification fields", () => {
  const items = (response: ReturnType<ReturnType<typeof tools>["catalog"]>) =>
    response.packages.flatMap((group) => group.skills);

  it("adds no verification fields to a call without runtime or verifiedOnly", () => {
    const all = items(tools().catalog());
    expect(all.every((item) => !("verifiedRuntimes" in item))).toBe(true);
    expect(all.every((item) => !("verified" in item))).toBe(true);
  });

  it("lists verifiedRuntimes only where there are some once verification is asked for", () => {
    const all = items(tools().catalog({ verifiedOnly: false }));
    const byName = Object.fromEntries(
      all.map((item) => [item.name.split("/")[2]!, item]),
    );
    expect(byName["plain"]).not.toHaveProperty("verifiedRuntimes");
    expect(byName["both"]!.verifiedRuntimes).toEqual([
      "claude-code",
      "codex-cli",
    ]);
    expect(byName["bogus"]!.verifiedRuntimes).toEqual(["claude-code"]);
    expect(all.every((item) => !("verified" in item))).toBe(true);
    expect(catalogResponseSchema.safeParse(tools().catalog()).success).toBe(
      true,
    );
  });

  it("orders verified first within a group and marks them, keeping the rest", () => {
    const all = items(tools().catalog({ runtime: "codex-cli" }));
    expect(names(all)).toEqual(["both", "codex-only", "bogus", "plain"]);
    expect(all.map((item) => item.verified)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it("verifiedOnly filters to the runtime, or to any runtime without one", () => {
    expect(
      names(
        items(tools().catalog({ runtime: "codex-cli", verifiedOnly: true })),
      ),
    ).toEqual(["both", "codex-only"]);
    expect(names(items(tools().catalog({ verifiedOnly: true })))).toEqual([
      "bogus",
      "both",
      "codex-only",
    ]);
  });

  it("uses the client runtime for ordering but never for filtering when enabled", () => {
    const response = ranking().catalog({
      clientRuntime: "claude-code",
      verifiedOnly: true,
    });
    expect(names(items(response))).toEqual(["bogus", "both", "codex-only"]);
    const ordered = items(ranking().catalog({ clientRuntime: "claude-code" }));
    expect(ordered).toHaveLength(4);
    expect(names(ordered).slice(0, 2).sort()).toEqual(["bogus", "both"]);
  });

  it("ignores the client runtime by default, so ordering matches a call without runtime", () => {
    const plain = items(tools().catalog({}));
    const withClient = items(tools().catalog({ clientRuntime: "claude-code" }));
    expect(names(withClient)).toEqual(names(plain));
    expect(withClient.every((item) => !("verified" in item))).toBe(true);
  });
});

describe("skill_find verification fields and ranking", () => {
  it("is unchanged for a caller with no runtime", async () => {
    const result = await tools().find("deploy the stage runner");
    expect(result).not.toHaveProperty("runtime");
    expect(names(result.matches)).toEqual([
      "bogus",
      "both",
      "codex-only",
      "plain",
    ]);
    expect(result.matches.every((m) => !("verified" in m))).toBe(true);
    expect(result.matches.every((m) => !("verifiedRuntimes" in m))).toBe(true);
    expect(findResultSchema.safeParse(result).success).toBe(true);
  });

  it("ranks verified matches first and marks them under an explicit runtime", async () => {
    const result = await tools().find("deploy the stage runner", 3, {
      runtime: "codex-cli",
    });
    expect(result.runtime).toBe("codex-cli");
    expect(names(result.matches)).toEqual(["both", "codex-only", "bogus"]);
    expect(result.matches.map((m) => m.verified)).toEqual([true, true, false]);
    expect(result.matches[0]!.verifiedRuntimes).toEqual([
      "claude-code",
      "codex-cli",
    ]);
  });

  it("ignores the detected runtime unless the server opts in", async () => {
    const result = await tools().find(
      "deploy the stage runner",
      5,
      undefined,
      "claude-code",
    );
    expect(result).not.toHaveProperty("runtime");
    expect(names(result.matches)).toEqual(
      names((await tools().find("deploy the stage runner", 5)).matches),
    );
  });

  it("falls back to the detected runtime for ranking only", async () => {
    const result = await ranking().find(
      "deploy the stage runner",
      5,
      undefined,
      "claude-code",
    );
    expect(result.runtime).toBe("claude-code");
    expect(names(result.matches)).toEqual([
      "bogus",
      "both",
      "codex-only",
      "plain",
    ]);
    expect(result.matches).toHaveLength(4);
  });

  it("an explicit runtime wins over the detected one", async () => {
    const result = await tools().find(
      "deploy the stage runner",
      5,
      { runtime: "codex-cli" },
      "claude-code",
    );
    expect(result.runtime).toBe("codex-cli");
    expect(names(result.matches).slice(0, 2)).toEqual(["both", "codex-only"]);
  });

  it("verifiedOnly filters, and never from the detected runtime alone", async () => {
    const filtered = await tools().find("deploy the stage runner", 5, {
      runtime: "codex-cli",
      verifiedOnly: true,
    });
    expect(names(filtered.matches)).toEqual(["both", "codex-only"]);
    const detectedOnly = await ranking().find(
      "deploy the stage runner",
      5,
      { verifiedOnly: true },
      "codex-cli",
    );
    expect(names(detectedOnly.matches)).toEqual([
      "both",
      "codex-only",
      "bogus",
    ]);
  });
});

describe("skill_describe nested metadata", () => {
  it("keeps the requires map in the catalog entry", () => {
    const withRequires = createSkillTools({
      roots: [],
      loadCatalog: () => [
        entry("needs", {
          requires: { mcp: ["skills"], "gpu-gb": "24" },
          "verified-runtimes": ["codex-cli"],
        }),
      ],
    });
    expect(
      withRequires.entry("@acme/pack/needs")?.metadata?.["requires"],
    ).toEqual({
      mcp: ["skills"],
      "gpu-gb": "24",
    });
    expect(
      describeResponseSchema.safeParse({
        name: "n",
        kind: "skill",
        package: "p",
        description: "d",
        metadata: { "requires.mcp": ["skills"], "requires.gpu-gb": "24" },
        frontmatter: "",
        files: [],
        filesTruncated: false,
      }).success,
    ).toBe(true);
  });
});

describe("registered tools detect the client", () => {
  function fakeServer(clientName?: string) {
    const registered = new Map<
      string,
      (args: Record<string, unknown>, ctx?: unknown) => Promise<unknown>
    >();
    const server = {
      server: {
        getClientVersion: () =>
          clientName === undefined ? undefined : { name: clientName },
      },
      registerTool(
        name: string,
        _config: unknown,
        handler: (
          args: Record<string, unknown>,
          ctx?: unknown,
        ) => Promise<unknown>,
      ) {
        registered.set(name, handler);
        return server;
      },
    };
    registerSkillTools(server as never, ranking());
    return registered;
  }
  const structuredOf = (result: unknown) =>
    (result as { structuredContent: { runtime: string | null } })
      .structuredContent;

  it("reports the detected runtime in the find answer", async () => {
    const find = fakeServer("codex-mcp-client").get("skill_find")!;
    const result = await find({ intent: "deploy the stage runner" });
    expect(structuredOf(result).runtime).toBe("codex-cli");
  });

  it("leaves runtime out for an unrecognised or absent client", async () => {
    for (const name of ["some-ide", undefined]) {
      const find = fakeServer(name).get("skill_find")!;
      const result = await find({ intent: "deploy the stage runner" });
      expect(structuredOf(result)).not.toHaveProperty("runtime");
    }
  });

  it("lets an explicit runtime input override the detected one", async () => {
    const find = fakeServer("codex-mcp-client").get("skill_find")!;
    const result = await find({
      intent: "deploy the stage runner",
      runtime: "claude-code",
    });
    expect(structuredOf(result).runtime).toBe("claude-code");
  });
});
