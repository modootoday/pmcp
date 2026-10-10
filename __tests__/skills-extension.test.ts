import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { readCatalog } from "../src/catalog.js";
import { createSkillHttpHandler } from "../src/http.js";
import { extensionEntry, SKILLS_EXTENSION } from "../src/skills-extension.js";

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A workspace whose skills cover each case the extension decides on. */
function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "pmcp-ext-"));
  write(join(root, "package.json"), JSON.stringify({ name: "@acme/kit" }));
  write(
    join(root, ".agents", "skills", "refunds", "SKILL.md"),
    "---\nname: refunds\ndescription: |\n  Process refunds.\n  Two lines.\nmetadata:\n  tier: open\n---\n\nSee references/policy.md.\n",
  );
  write(
    join(root, ".agents", "skills", "refunds", "references", "policy.md"),
    "Policy.\n",
  );
  write(
    join(root, ".agents", "skills", "unnamed", "SKILL.md"),
    "---\ndescription: Has no name field.\n---\n\nBody.\n",
  );
  write(
    join(root, ".agents", "skills", "mismatch", "SKILL.md"),
    "---\nname: other-name\ndescription: Name differs from the directory.\n---\n\nBody.\n",
  );
  return root;
}

const sha = (path: string) =>
  `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;

describe("extensionEntry", () => {
  it("serves a conforming skill with every file digested and the frontmatter as YAML reads it", () => {
    const root = workspace();
    const skill = readCatalog({ roots: [], workspaces: [root] }).find(
      (e) => e.slug === "refunds",
    )!;
    const entry = extensionEntry(skill)!;
    expect(entry.uri).toBe("skill://pmcp/@acme/kit/refunds/SKILL.md");
    expect(entry.frontmatter).toEqual({
      name: "refunds",
      description: "Process refunds.\nTwo lines.\n",
      metadata: { tier: "open" },
    });
    const skillMd = join(root, ".agents", "skills", "refunds", "SKILL.md");
    expect(entry.resources).toEqual([
      {
        uri: "skill://pmcp/@acme/kit/refunds/SKILL.md",
        digest: sha(skillMd),
        size: readFileSync(skillMd).length,
      },
      {
        uri: "skill://pmcp/@acme/kit/refunds/references/policy.md",
        digest: sha(join(dirname(skillMd), "references", "policy.md")),
        size: 8,
      },
    ]);
  });

  it("leaves out a skill whose frontmatter name is missing or differs from its path", () => {
    const catalog = readCatalog({ roots: [], workspaces: [workspace()] });
    const served = catalog
      .map(extensionEntry)
      .filter(Boolean)
      .map((e) => e!.uri);
    expect(served).toEqual(["skill://pmcp/@acme/kit/refunds/SKILL.md"]);
  });
});

describe("over the protocol", () => {
  const handler = (root: string) =>
    createSkillHttpHandler({
      roots: [],
      workspaces: [root],
      authorize: () => ({ id: "user-1" }),
    });

  async function rpc(
    h: ReturnType<typeof handler>,
    method: string,
    params: Record<string, unknown>,
  ) {
    const response = await h.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    );
    const text = await response.text();
    const data = text.startsWith("{")
      ? text
      : (text
          .split("\n")
          .find((l) => l.startsWith("data:"))
          ?.slice(5) ?? "{}");
    return JSON.parse(data) as Record<string, any>;
  }

  it("declares the extension and the resources capability", async () => {
    const result = (
      await rpc(handler(workspace()), "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "t", version: "0" },
      })
    ).result;
    expect(result.capabilities.extensions).toEqual({ [SKILLS_EXTENSION]: {} });
    expect(result.capabilities.resources).toBeDefined();
  });

  it("lists, gets and reads a skill", async () => {
    const h = handler(workspace());
    const listed = (await rpc(h, "skills/list", {})).result;
    expect(listed.skills.map((s: { uri: string }) => s.uri)).toEqual([
      "skill://pmcp/@acme/kit/refunds/SKILL.md",
    ]);
    // Behind authorization the list is filtered per caller.
    expect(listed.cacheScope).toBe("private");

    const got = (
      await rpc(h, "skills/get", {
        uri: "skill://pmcp/@acme/kit/refunds/SKILL.md",
      })
    ).result;
    expect(got.skill.frontmatter.name).toBe("refunds");

    const read = (
      await rpc(h, "resources/read", {
        uri: "skill://pmcp/@acme/kit/refunds/references/policy.md",
      })
    ).result;
    expect(read.contents[0].text).toBe("Policy.\n");
  });

  it("answers an unknown skill and an unlisted file with invalid params", async () => {
    const h = handler(workspace());
    expect(
      (
        await rpc(h, "skills/get", {
          uri: "skill://pmcp/@acme/kit/nope/SKILL.md",
        })
      ).error.code,
    ).toBe(-32602);
    const outside = await rpc(h, "resources/read", {
      uri: "skill://pmcp/@acme/kit/mismatch/SKILL.md",
    });
    expect(outside.error).toBeDefined();
  });
});
