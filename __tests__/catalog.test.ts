import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { readBody, readCatalog, readFrontmatter } from "../src/catalog.js";

const root = mkdtempSync(join(tmpdir(), "skill-catalog-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const modules = join(root, "node_modules");

function makePackage(
  dir: string,
  name: string,
  skills: Record<string, string> = {},
): void {
  const packageDir = join(modules, dir);
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name }));
  for (const [slug, body] of Object.entries(skills)) {
    const skillDir = join(packageDir, ".agent/skills", slug);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), body);
  }
}

const skill = (name: string, description: string, body = "how to wire it") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;

describe("readFrontmatter", () => {
  it("reads flat scalars", () => {
    expect(readFrontmatter("---\nname: a\ndescription: b\n---\nbody")).toEqual({
      name: "a",
      description: "b",
    });
  });

  it("strips surrounding quotes", () => {
    expect(readFrontmatter('---\ndescription: "b: c"\n---\n')["description"]).toBe(
      "b: c",
    );
  });

  it("returns nothing for a file with no frontmatter", () => {
    expect(readFrontmatter("# just a heading")).toEqual({});
  });

  it("returns nothing when the block is never closed", () => {
    expect(readFrontmatter("---\nname: a\nstill going")).toEqual({});
  });

  it("skips a key with no value rather than storing an empty one", () => {
    expect(readFrontmatter("---\nname: a\ndescription:\n---\n")).toEqual({ name: "a" });
  });
});

describe("readBody", () => {
  it("returns what follows the frontmatter", () => {
    expect(readBody("---\nname: a\n---\n\nbody here\n")).toBe("body here\n");
  });

  it("returns the whole file when there is no frontmatter", () => {
    expect(readBody("body only")).toBe("body only");
  });
});

describe("readCatalog", () => {
  makePackage("plain", "@acme/plain", { adoption: skill("adoption", "Wire the plain package") });
  makePackage("@scope/scoped", "@scope/scoped", {
    adoption: skill("adoption", "Wire the scoped package"),
    extra: skill("extra", "Something else entirely"),
  });
  makePackage("no-skills", "@acme/no-skills");
  makePackage("undescribed", "@acme/undescribed", {
    mute: "---\nname: mute\n---\nbody\n",
  });
  makePackage("broken-manifest", "@acme/ignored");
  writeFileSync(join(modules, "broken-manifest", "package.json"), "{ not json");

  const catalog = () => readCatalog({ roots: [modules] });

  it("finds a skill in an unscoped package", () => {
    expect(catalog().map((e) => e.name)).toContain("@acme/plain/adoption");
  });

  it("descends into a scope directory", () => {
    expect(catalog().map((e) => e.name)).toContain("@scope/scoped/adoption");
  });

  it("finds every skill a package ships", () => {
    expect(catalog().filter((e) => e.package === "@scope/scoped")).toHaveLength(2);
  });

  it("costs nothing for a package with no skills", () => {
    expect(catalog().some((e) => e.package === "@acme/no-skills")).toBe(false);
  });

  // find ranks descriptions. One without a description could only be found by
  // already knowing its name, and listing it spends tokens on an entry that
  // cannot answer.
  it("skips a skill with no description", () => {
    expect(catalog().some((e) => e.package === "@acme/undescribed")).toBe(false);
  });

  it("skips a package whose manifest does not parse rather than throwing", () => {
    expect(() => catalog()).not.toThrow();
    expect(catalog().some((e) => e.package === "@acme/ignored")).toBe(false);
  });

  it("returns nothing for a root that does not exist", () => {
    expect(readCatalog({ roots: [join(root, "absent")] })).toEqual([]);
  });

  it("sorts by name so the listing does not churn", () => {
    const names = catalog().map((e) => e.name);
    expect(names).toEqual([...names].sort());
  });

  it("narrows to a scope when one is given", () => {
    const scoped = readCatalog({ roots: [modules], scopes: ["@scope/"] });
    expect(scoped.every((e) => e.package.startsWith("@scope/"))).toBe(true);
    expect(scoped.length).toBeGreaterThan(0);
  });

  // A nested node_modules holds an older copy of what the root already
  // resolved, and the resolved one is what the consumer actually loads.
  it("keeps the first root's copy when two roots hold the same skill", () => {
    const nested = join(root, "nested-modules");
    makePackageAt(nested, "plain", "@acme/plain", {
      adoption: skill("adoption", "An older copy"),
    });
    const found = readCatalog({ roots: [modules, nested] });
    const entry = found.find((e) => e.name === "@acme/plain/adoption");
    expect(entry?.description).toBe("Wire the plain package");
  });
});

function makePackageAt(
  modulesRoot: string,
  dir: string,
  name: string,
  skills: Record<string, string>,
): void {
  const packageDir = join(modulesRoot, dir);
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name }));
  for (const [slug, body] of Object.entries(skills)) {
    const skillDir = join(packageDir, ".agent/skills", slug);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), body);
  }
}
