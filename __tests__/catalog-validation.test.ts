import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { readConfig } from "../src/config.js";
import { validateCatalog, validateSkillDir } from "../src/validate.js";

const root = mkdtempSync(join(tmpdir(), "pmcp-catalog-validation-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// Valid by the Agent Skills specification, but with no catalog metadata and a private term.
const PLAIN =
  "---\nname: wire\ndescription: Wire the package. Use when wiring it.\n---\n\nAsk SecretCo for the key.\n";
const LIBRARY =
  "---\nname: lib\ndescription: Library instructions. Use when coding.\nmetadata:\n  level: L2\n  ecosystem: maven\n---\n\nbody\n";

function project(toml: string): string {
  const dir = mkdtempSync(join(root, "project-"));
  writeFileSync(join(dir, "pmcp.toml"), toml);
  writeFileSync(join(dir, "deny.txt"), "# private names\n\nsecretco\n");
  for (const [slug, text] of [
    ["wire", PLAIN],
    ["lib", LIBRARY],
  ] as const) {
    const skill = join(dir, "node_modules/pkg/.agent/skills", slug);
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, "SKILL.md"), text);
  }
  writeFileSync(
    join(dir, "node_modules/pkg/package.json"),
    JSON.stringify({ name: "pkg" }),
  );
  return dir;
}

const skillDir = (dir: string, slug: string) =>
  join(dir, "node_modules/pkg/.agent/skills", slug);
const reasons = (findings: readonly { reason: string }[]) =>
  findings.map((finding) => finding.reason);

describe("[catalog.validation]", () => {
  it("keeps the specification check alone when the table is missing", () => {
    const dir = project("[catalog]\nroots = []\n");
    const settings = readConfig(join(dir, "pmcp.toml")).catalog.validation;
    expect(settings).toBeUndefined();
    expect(validateSkillDir(skillDir(dir, "wire"), settings)).toEqual([]);
    expect(validateSkillDir(skillDir(dir, "lib"), settings)).toEqual([]);
  });

  it("applies the catalog-v1 profile and a deny list without printing the term", () => {
    const dir = project(
      '[catalog.validation]\nprofile = "catalog-v1"\ndeny_list = "deny.txt"\n',
    );
    const settings = readConfig(join(dir, "pmcp.toml")).catalog.validation;
    expect(settings).toEqual({
      profile: "catalog-v1",
      denyList: join(dir, "deny.txt"),
    });
    const found = reasons(validateSkillDir(skillDir(dir, "wire"), settings));
    expect(found.some((reason) => reason.startsWith("schema.metadata"))).toBe(
      true,
    );
    expect(found).toContain("contains deny-list entry 1");
    expect(found.join(" ").toLowerCase()).not.toContain("secretco");
  });

  it("applies the library profile", () => {
    const dir = project('[catalog.validation]\nprofile = "library"\n');
    const settings = readConfig(join(dir, "pmcp.toml")).catalog.validation;
    const found = reasons(validateSkillDir(skillDir(dir, "lib"), settings));
    expect(found.some((reason) => reason.includes("ecosystem"))).toBe(true);
  });

  it("checks every catalog skill when no directory is named", () => {
    const dir = project(
      '[catalog.validation]\nprofile = "library"\ndeny_list = "deny.txt"\n',
    );
    const settings = readConfig(join(dir, "pmcp.toml")).catalog.validation;
    const found = validateCatalog(
      { roots: [join(dir, "node_modules")] },
      settings,
    );
    expect(found.map((finding) => finding.path)).toEqual(
      expect.arrayContaining([
        join(skillDir(dir, "lib"), "SKILL.md"),
        join(skillDir(dir, "wire"), "SKILL.md"),
      ]),
    );
  });

  it("reports a missing deny list instead of passing", () => {
    const dir = project('[catalog.validation]\ndeny_list = "absent.txt"\n');
    const settings = readConfig(join(dir, "pmcp.toml")).catalog.validation;
    expect(
      reasons(validateSkillDir(skillDir(dir, "wire"), settings)),
    ).toContain("deny_list file not found");
  });

  it.each([
    ['profile = "strict"', "profile must be catalog-v1 or library"],
    ['deny = "x"', "unknown key [catalog.validation] deny"],
    ["deny_list = 3", "deny_list must be a path"],
  ])("rejects %s", (line, message) => {
    const dir = project(`[catalog.validation]\n${line}\n`);
    expect(() => readConfig(join(dir, "pmcp.toml"))).toThrow(message);
  });
});
