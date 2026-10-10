import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { readMarketplace } from "../src/marketplace.js";
import { createSkillTools } from "../src/server.js";

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const md = (fields: string, body = "Body.") =>
  `---\n${fields}\n---\n\n${body}\n`;

/** One plugin carrying every asset kind the plugin format has. */
function marketplace(): string {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-assets-"));
  write(
    join(dir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "shop",
      metadata: { tier: "open" },
      plugins: [{ name: "kit", source: "./plugins/kit" }],
    }),
  );
  const kit = join(dir, "plugins", "kit");
  write(
    join(kit, ".claude-plugin", "plugin.json"),
    JSON.stringify({
      name: "kit",
      description: "A kit of guards.",
      hooks: "./hooks/hooks.json",
    }),
  );
  write(
    join(kit, "skills", "review", "SKILL.md"),
    md("name: review\ndescription: Use when reviewing a diff."),
  );
  write(
    join(kit, "commands", "plan.md"),
    md("description: Start a plan document."),
  );
  write(
    join(kit, "commands", "secret.md"),
    md("description: Should never be readable through plan."),
  );
  write(
    join(kit, "commands", "paid.md"),
    md("description: Mislabelled.\nmetadata:\n  tier: paid"),
  );
  write(
    join(kit, "agents", "reviewer.md"),
    md("name: reviewer\ndescription: Reviews diffs for naming."),
  );
  write(
    join(kit, "agents", "planner", "agent.md"),
    md("name: planner\ndescription: Plans work in phases."),
  );
  write(
    join(kit, "hooks", "hooks.json"),
    JSON.stringify({
      description: "Refuse destructive shell commands.",
      hooks: { PreToolUse: [] },
    }),
  );
  write(join(kit, "scripts", "guard.mjs"), "export {};\n");
  write(
    join(kit, ".mcp.json"),
    JSON.stringify({
      mcpServers: { docs: { command: "npx", args: ["docs-mcp"] } },
    }),
  );
  return dir;
}

describe("readMarketplace", () => {
  it("reads skills, commands, agents, hooks and MCP servers from one plugin", () => {
    const rejected: string[] = [];
    const entries = readMarketplace(marketplace(), (r) =>
      rejected.push(r.reason),
    );
    const byName = Object.fromEntries(
      entries.map((e) => [e.name, e.kind ?? "skill"]),
    );
    expect(byName).toEqual({
      "shop/kit/review": "skill",
      "shop/kit/plan": "skill",
      "shop/kit/secret": "skill",
      "shop/kit/agents/reviewer": "agent",
      "shop/kit/agents/planner": "agent",
      "shop/kit/hooks": "hook",
      "shop/kit/mcp/docs": "mcp",
    });
    expect(rejected).toEqual(["metadata.tier paid in a open marketplace"]);
  });
});

describe("tools over every kind", () => {
  const tools = () =>
    createSkillTools({ roots: [], marketplaces: [marketplace()] });

  it("lists only skills unless a kind is asked for", () => {
    const names = (kind?: "agent" | "any") =>
      tools()
        .catalog(kind ? { kind } : {})
        .packages.flatMap((p) => p.skills.map((s) => s.name));
    expect(names()).toEqual([
      "shop/kit/plan",
      "shop/kit/review",
      "shop/kit/secret",
    ]);
    expect(names("agent")).toEqual([
      "shop/kit/agents/planner",
      "shop/kit/agents/reviewer",
    ]);
    expect(names("any")).toHaveLength(7);
  });

  it("labels a catalog line with its kind only when it is not a skill", () => {
    const lines = tools().catalog({ kind: "any" }).packages[0]!.skills;
    expect(
      lines.find((l) => l.name === "shop/kit/review")?.kind,
    ).toBeUndefined();
    expect(lines.find((l) => l.name === "shop/kit/hooks")?.kind).toBe("hook");
  });

  it("finds a hook only when the search asks for hooks", async () => {
    const plain = await tools().find("refuse destructive shell commands");
    expect(plain.matches.map((m) => m.name)).not.toContain("shop/kit/hooks");
    const hooks = await tools().find("refuse destructive shell commands", 5, {
      kind: "hook",
    });
    expect(hooks.matches.map((m) => m.name)).toEqual(["shop/kit/hooks"]);
  });

  it("scopes a command to its own file", () => {
    const described = tools().describe("shop/kit/plan")!;
    expect(described.kind).toBe("skill");
    expect(described.files.map((f) => f.path)).toEqual(["plan.md"]);
    const t = tools();
    expect(t.read("shop/kit/plan").ok).toBe(true);
    expect(t.read("shop/kit/plan", "secret.md")).toMatchObject({
      ok: false,
      error: "path_outside_skill",
    });
  });

  it("scopes a hook to its plugin, so the script it runs can be read", () => {
    const t = tools();
    expect(t.describe("shop/kit/hooks")!.files.map((f) => f.path)).toContain(
      "scripts/guard.mjs",
    );
    expect(t.read("shop/kit/hooks", "scripts/guard.mjs").ok).toBe(true);
    expect(t.read("shop/kit/hooks")).toMatchObject({
      ok: true,
      path: "hooks/hooks.json",
    });
  });

  it("returns an MCP server's config as written", () => {
    const body = tools().call("shop/kit/mcp/docs")!.body;
    expect(JSON.parse(body)).toEqual({
      mcpServers: { docs: { command: "npx", args: ["docs-mcp"] } },
    });
  });

  it("reads an agent body without its frontmatter", () => {
    expect(tools().call("shop/kit/agents/planner")!.body.trim()).toBe("Body.");
  });
});
