import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { MAX_SKILL_DEPTH, readCatalog } from "../src/catalog.js";

const root = mkdtempSync(join(tmpdir(), "pmcp-discovery-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const modules = join(root, "node_modules");

const skill = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\nhow to wire it\n`;

function write(packageName: string, relativePath: string, contents: string): void {
  const path = join(modules, packageName, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents);
}

function makePackage(packageName: string): void {
  mkdirSync(join(modules, packageName), { recursive: true });
  writeFileSync(
    join(modules, packageName, "package.json"),
    JSON.stringify({ name: packageName }),
  );
}

// One package per convention, so a regression naming the wrong directory loses
// exactly one entry rather than all of them.
const CONVENTIONS = [
  ["pkg-plain", "skills"],
  ["pkg-agent", ".agent/skills"],
  ["pkg-claude", ".claude/skills"],
  ["pkg-gemini", ".gemini/skills"],
  ["pkg-codex", ".codex/skills"],
] as const;

for (const [packageName, dir] of CONVENTIONS) {
  makePackage(packageName);
  write(
    packageName,
    `${dir}/the-slug/SKILL.md`,
    skill("the-slug", `Something goes wrong in ${packageName} and you need it.`),
  );
}

describe("discovery is by shape rather than by path", () => {
  const catalog = readCatalog({ roots: [modules] });

  it.each(CONVENTIONS)("finds a skill under %s/%s", (packageName) => {
    expect(catalog.map((entry) => entry.package)).toContain(packageName);
  });

  it("finds every convention, so no directory is silently unread", () => {
    expect(catalog).toHaveLength(CONVENTIONS.length);
  });
});

describe("what discovery refuses to walk", () => {
  it("ignores a SKILL.md in a nested install, a cache or a test corpus", () => {
    makePackage("pkg-noise");
    for (const dir of ["node_modules/inner", "__tests__", ".git", "coverage"]) {
      write(
        "pkg-noise",
        `${dir}/decoy/SKILL.md`,
        skill("decoy", "A decoy that must never be catalogued."),
      );
    }

    const entries = readCatalog({ roots: [modules] }).filter(
      (entry) => entry.package === "pkg-noise",
    );
    expect(entries).toEqual([]);
  });

  // The skip list once held `lib`, which hid the most widely installed skill in
  // the real world. Nothing a package builds into is skipped now.
  it.each(["lib", "dist", "build", "out"])(
    "finds a skill a package ships under %s",
    (dir) => {
      const name = `pkg-under-${dir}`;
      makePackage(name);
      write(
        name,
        `${dir}/skill/SKILL.md`,
        skill("shipped", `A skill this package ships under ${dir}.`),
      );

      expect(
        readCatalog({ roots: [modules] }).map((entry) => entry.name),
      ).toContain(`${name}/shipped`);
    },
  );

  it("stops at the declared depth rather than walking the whole package", () => {
    makePackage("pkg-deep");
    const tooDeep = Array.from({ length: MAX_SKILL_DEPTH + 1 }, (_, i) => `d${i}`).join("/");
    write("pkg-deep", `${tooDeep}/SKILL.md`, skill("too-deep", "Deeper than the limit."));

    const entries = readCatalog({ roots: [modules] }).filter(
      (entry) => entry.package === "pkg-deep",
    );
    expect(entries).toEqual([]);
  });
});

describe("naming a skill found anywhere", () => {
  it("takes the slug from frontmatter when it disagrees with the directory", () => {
    makePackage("pkg-renamed");
    write(
      "pkg-renamed",
      "skills/directory-name/SKILL.md",
      skill("frontmatter-name", "The frontmatter and the directory disagree."),
    );

    const entry = readCatalog({ roots: [modules] }).find(
      (candidate) => candidate.package === "pkg-renamed",
    );
    expect(entry?.slug).toBe("frontmatter-name");
    expect(entry?.name).toBe("pkg-renamed/frontmatter-name");
  });

  it("catalogues a SKILL.md sitting at the package root", () => {
    makePackage("pkg-root");
    write("pkg-root", "SKILL.md", skill("", "A skill the package keeps at its root."));

    const entry = readCatalog({ roots: [modules] }).find(
      (candidate) => candidate.package === "pkg-root",
    );
    expect(entry?.name).toBe("pkg-root/pkg-root");
  });
});
