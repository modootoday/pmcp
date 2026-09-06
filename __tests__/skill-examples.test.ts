// Every example in .agent/skills/skill-catalog-mcp/SKILL.md, run against the
// real package over a real node_modules-shaped fixture. The walk is the part a
// mock would get wrong, so nothing here is mocked except the Embedder, which
// has no default by design.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createSkillTools, find, type Embedder } from "../src/index.js";

function writeSkill(
  nodeModules: string,
  packageName: string,
  slug: string,
  description: string,
  body: string,
): void {
  const packageDir = join(nodeModules, ...packageName.split("/"));
  const skillDir = join(packageDir, ".agent", "skills", slug);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(packageDir, "package.json"),
    JSON.stringify({ name: packageName, version: "1.0.0" }),
  );
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${slug}\ndescription: ${description}\n---\n\n${body}\n`,
  );
}

// A project root holding a node_modules with four installed packages, two of
// them under one scope. Returned as { projectRoot, nodeModules } because the
// "why does it find nothing" example needs both.
function project(): { projectRoot: string; nodeModules: string } {
  const projectRoot = mkdtempSync(join(tmpdir(), "skill-mcp-examples-"));
  const nodeModules = join(projectRoot, "node_modules");
  mkdirSync(nodeModules, { recursive: true });

  writeSkill(
    nodeModules,
    "@acme/thing",
    "widget-wiring",
    "Wiring a widget into a host application.",
    "Widget body text.",
  );
  writeSkill(
    nodeModules,
    "@acme/lint-owner",
    "path-ownership",
    "Decide which changed files a lint rule owns, matching paths against globs.",
    "Ownership body text.",
  );
  writeSkill(
    nodeModules,
    "@other/unrelated",
    "invoicing",
    "Issuing an invoice and reconciling a payment against it.",
    "Invoice body text.",
  );
  writeSkill(
    nodeModules,
    "plainpkg",
    "release-notes",
    "Assembling release notes from a range of commits.",
    "Release body text.",
  );

  return { projectRoot, nodeModules };
}

const { projectRoot, nodeModules } = project();

describe("SKILL.md — Install and wire", () => {
  it("finds a match and reads exactly one body", async () => {
    const tools = createSkillTools({ roots: [nodeModules] });

    const { ranking, matches } = await tools.find(
      "how do I match file paths in a lint rule",
    );
    const body = matches[0] ? (tools.call(matches[0].name)?.body ?? null) : null;

    expect(ranking).toBe("lexical");
    expect(matches.length).toBeGreaterThan(0);
    expect(body?.trim()).toBe("Ownership body text.");
  });
});

describe("SKILL.md — worked example 1, seeing what exists without bodies", () => {
  const tools = createSkillTools({
    roots: [nodeModules],
    scopes: ["@acme/"],
  });

  it("lists names and descriptions for the named scope only", () => {
    const { count, packages } = tools.catalog();
    expect(count).toBe(2);
    expect(packages.map((group) => group.package)).toEqual([
      "@acme/lint-owner",
      "@acme/thing",
    ]);
    for (const group of packages) {
      for (const skill of group.skills) {
        expect(skill.name.startsWith("@acme/")).toBe(true);
        expect(skill.description.length).toBeGreaterThan(0);
      }
    }
  });

  it("returns no bodies at all from the catalog", () => {
    const response = tools.catalog();
    expect(JSON.stringify(response)).not.toContain("body text");
  });
});

describe("SKILL.md — worked example 2, from a question to one document", () => {
  const tools = createSkillTools({ roots: [nodeModules] });

  it("ranks, reads one body, and answers null for an unknown name", async () => {
    const { ranking, matches } = await tools.find(
      "how do I decide which changed files a lint rule owns",
      3,
    );

    expect(ranking).toBe("lexical");
    expect(matches.length).toBeLessThanOrEqual(3);

    const best = matches[0];
    expect(best?.name).toBe("@acme/lint-owner/path-ownership");

    const body = best ? tools.call(best.name) : null;
    expect(body?.body.trim()).toBe("Ownership body text.");

    expect(tools.call("@acme/nothing/here")).toBe(null);
  });

  it("returns an empty list rather than the whole catalog when nothing overlaps", async () => {
    const { matches } = await tools.find("zzzz qqqq");
    expect(matches).toEqual([]);
  });
});

describe("SKILL.md — worked example 3, why the catalog comes back empty", () => {
  it("finds nothing when roots name a project root", () => {
    const empty = createSkillTools({ roots: [projectRoot] });
    expect(empty.catalog().count).toBe(0);
  });

  it("finds the installed skills when roots name the node_modules directory", () => {
    const wired = createSkillTools({ roots: [`${projectRoot}/node_modules`] });
    expect(wired.catalog().count).toBe(4);
  });
});

describe("SKILL.md — Testing against it, the fixture", () => {
  // Transcribed from the Fixtures subsection, verbatim in shape.
  function fixture(): string {
    const root = mkdtempSync(join(tmpdir(), "skill-fixture-"));
    const pkg = join(root, "node_modules", "@acme", "thing");
    const skill = join(pkg, ".agent", "skills", "widget-wiring");
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@acme/thing" }));
    writeFileSync(
      join(skill, "SKILL.md"),
      "---\nname: widget-wiring\ndescription: Wiring a widget into a host application.\n---\n\nBody text.\n",
    );
    return join(root, "node_modules");
  }

  const tools = createSkillTools({ roots: [fixture()] });

  it("lists the skill under its package, with no body", () => {
    const response = tools.catalog();
    expect(response.count).toBe(1);
    expect(response.packages[0]?.package).toBe("@acme/thing");
    expect(response.packages[0]?.skills[0]?.name).toBe("@acme/thing/widget-wiring");
  });

  it("finds it lexically and reads the body only when asked", async () => {
    const { ranking, matches } = await tools.find("wiring a widget into a host");
    expect(ranking).toBe("lexical");
    expect(matches[0]?.name).toBe("@acme/thing/widget-wiring");
    expect(tools.call(matches[0]!.name)?.body.trim()).toBe("Body text.");
  });
});

describe("SKILL.md — Invariants", () => {
  it("skips a skill with no description rather than listing it", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-nodesc-"));
    const nm = join(root, "node_modules");
    const pkg = join(nm, "@acme", "quiet");
    const skill = join(pkg, ".agent", "skills", "undocumented");
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@acme/quiet" }));
    writeFileSync(join(skill, "SKILL.md"), "---\nname: undocumented\n---\n\nBody.\n");

    expect(createSkillTools({ roots: [nm] }).catalog().count).toBe(0);
  });

  it("keeps the first root's copy when a name is seen twice", () => {
    const second = project().nodeModules;
    const tools = createSkillTools({ roots: [nodeModules, second] });
    expect(tools.catalog().count).toBe(4);
  });

  it("memoises until refresh drops the catalog", () => {
    const root = mkdtempSync(join(tmpdir(), "skill-refresh-"));
    const nm = join(root, "node_modules");
    mkdirSync(nm, { recursive: true });
    const tools = createSkillTools({ roots: [nm] });
    expect(tools.catalog().count).toBe(0);

    writeSkill(nm, "@acme/late", "arrived-later", "A skill installed after the first walk.", "Late.");
    expect(tools.catalog().count).toBe(0);

    tools.refresh();
    expect(tools.catalog().count).toBe(1);
  });

  it("falls back to lexical when vector coverage is incomplete", async () => {
    const entries = createSkillTools({ roots: [nodeModules] });
    const catalogNames = entries
      .catalog()
      .packages.flatMap((group) => group.skills.map((skill) => skill.name));

    const embedder: Embedder = {
      modelId: "test-model",
      dims: 2,
      embed: async () => Float32Array.from([1, 0]),
    };

    const raw = entries.entries();
    const full = new Map(catalogNames.map((name) => [name, Float32Array.from([1, 0])]));
    const partial = new Map([...full].slice(0, 1));

    const withPartial = await find({
      entries: raw.map((entry) => ({ ...entry, path: "unused" })),
      intent: "anything",
      embedder,
      vectors: partial,
    });
    expect(withPartial.ranking).toBe("lexical");

    const withFull = await find({
      entries: raw.map((entry) => ({ ...entry, path: "unused" })),
      intent: "anything",
      embedder,
      vectors: full,
    });
    expect(withFull.ranking).toBe("semantic");
  });
});
