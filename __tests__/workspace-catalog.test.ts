import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  expandBraces,
  expandRootGlob,
  readCatalog,
  workspacePackageDirs,
} from "../src/catalog.js";

const root = mkdtempSync(join(tmpdir(), "skill-workspace-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function makeDir(
  dir: string,
  manifest: Record<string, unknown>,
  skills: Record<string, string> = {},
  skillsDir = ".claude/skills",
): void {
  const full = join(root, dir);
  mkdirSync(full, { recursive: true });
  writeFileSync(join(full, "package.json"), JSON.stringify(manifest));
  for (const [slug, description] of Object.entries(skills)) {
    const skillDir = join(full, skillsDir, slug);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\nname: ${slug}\ndescription: ${description}\n---\n\nbody\n`,
    );
  }
}

makeDir(
  "mono",
  {
    name: "mono-root",
    workspaces: ["units/*", "deep/**/pkg", "brand/{web,api}", "!units/skip"],
  },
  { "root-skill": "Root level." },
);
makeDir("mono/units/one", { name: "@m/one" }, { near: "Inside a member." });
makeDir("mono/units/skip", { name: "@m/skip" }, { hidden: "Excluded." });
makeDir("mono/deep/a/b/pkg", { name: "@m/deep" }, { deep: "Deep glob." });
makeDir("mono/brand/web", { name: "@m/web" });
makeDir("mono/brand/api", { name: "@m/api" });
makeDir("mono/brand/cli", { name: "@m/cli" }, { cli: "Not in braces." });
makeDir(
  "mono/units/nested",
  { name: "nested-root", workspaces: { packages: ["libs/*"] } },
  {},
);
makeDir(
  "mono/units/nested/libs/x",
  { name: "@n/x" },
  { inner: "Nested." },
  "skills",
);
makeDir("loose", { name: "loose-brand" }, { solo: "A lone package." });

describe("expandBraces", () => {
  it("expands one alternation", () => {
    expect(expandBraces("a/{b,c}/d")).toEqual(["a/b/d", "a/c/d"]);
  });

  it("leaves a plain pattern alone", () => {
    expect(expandBraces("units/*")).toEqual(["units/*"]);
  });
});

describe("workspacePackageDirs", () => {
  const dirs = workspacePackageDirs(join(root, "mono")).map((d) =>
    d.slice(root.length + 1),
  );

  it("lists the root after its members", () => {
    expect(dirs.at(-1)).toBe("mono");
  });

  it("follows *, ** and brace patterns and drops negated ones", () => {
    expect(dirs).toEqual(
      expect.arrayContaining([
        "mono/units/one",
        "mono/deep/a/b/pkg",
        "mono/brand/web",
        "mono/brand/api",
      ]),
    );
    expect(dirs).not.toContain("mono/units/skip");
    expect(dirs).not.toContain("mono/brand/cli");
  });

  it("expands a member that is itself a workspace root", () => {
    expect(dirs).toContain("mono/units/nested/libs/x");
    expect(dirs.indexOf("mono/units/nested/libs/x")).toBeLessThan(
      dirs.indexOf("mono/units/nested"),
    );
  });
});

describe("readCatalog with workspaces and packages", () => {
  const names = readCatalog({
    roots: [],
    workspaces: [join(root, "mono")],
    packages: [join(root, "loose")],
  }).map((e) => e.name);

  it("credits a skill to the member that holds it", () => {
    expect(names).toContain("@m/one/near");
    expect(names).not.toContain("mono-root/near");
  });

  it("reads the root's own skills", () => {
    expect(names).toContain("mono-root/root-skill");
  });

  it("reads nested and deep members", () => {
    expect(names).toEqual(
      expect.arrayContaining(["@n/x/inner", "@m/deep/deep"]),
    );
  });

  it("reads a package directory given directly", () => {
    expect(names).toContain("loose-brand/solo");
  });
});

describe("family globs and folders without a manifest", () => {
  makeDir("fams/one", { name: "fam-one", workspaces: ["libs/*"] });
  makeDir("fams/one/libs/a", { name: "@f/a" }, { fa: "Family member." });
  makeDir("fams/two", { name: "fam-two" }, { ft: "Family root." });
  mkdirSync(join(root, "fams/not-a-package"), { recursive: true });
  const plain = join(root, "plain-docs");
  mkdirSync(join(plain, ".agent/skills/guide"), { recursive: true });
  writeFileSync(
    join(plain, ".agent/skills/guide/SKILL.md"),
    "---\nname: guide\ndescription: No manifest here.\n---\n\nbody\n",
  );

  it("expands a glob of workspace roots", () => {
    expect(expandRootGlob(join(root, "fams/*"))).toEqual([
      join(root, "fams/one"),
      join(root, "fams/two"),
    ]);
  });

  it("reads every root the glob names and their members", () => {
    const names = readCatalog({
      roots: [],
      workspaces: [join(root, "fams/*")],
    }).map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(["@f/a/fa", "fam-two/ft"]));
  });

  it("names a manifest-less package directory after its folder", () => {
    const names = readCatalog({ roots: [], packages: [plain] }).map(
      (e) => e.name,
    );
    expect(names).toEqual(["plain-docs/guide"]);
  });

  it("still skips a manifest-less directory reached through a workspace", () => {
    const names = readCatalog({
      roots: [],
      workspaces: [join(root, "fams/not-a-package")],
    });
    expect(names).toEqual([]);
  });
});
