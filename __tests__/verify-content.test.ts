import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  contentDigest,
  verifyInstalledContent,
} from "../src/install/verify-content.js";

const roots: string[] = [];
afterEach(() => {
  for (const path of roots.splice(0))
    rmSync(path, { recursive: true, force: true });
});

const SKILL =
  "---\nname: example\ndescription: Use it safely.\n---\n\nVerified against zod@4.5.4 on 2026-09-07. 1 of 1 examples executed.\n";

function project(body = SKILL) {
  const root = mkdtempSync(join(tmpdir(), "pmcp-verify-"));
  roots.push(root);
  const pkg = join(root, "node_modules/@pmcp/example/skills/example");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "SKILL.md"), body);
  return root;
}

it("accepts content that matches what the catalog described", () => {
  const root = project();
  const expected = contentDigest(new Map([["skills/example/SKILL.md", SKILL]]));
  const check = verifyInstalledContent(root, "@pmcp/example", expected);
  expect(check).toMatchObject({
    matched: true,
    skillCount: 1,
    actual: expected,
  });
});

it("refuses a package that carries the right name and the wrong content", () => {
  // What a resolver reaching another registry would produce: the name and the
  // version agree, and the file is somebody else's.
  const expected = contentDigest(new Map([["skills/example/SKILL.md", SKILL]]));
  const substituted = verifyInstalledContent(
    project("---\nname: example\ndescription: x\n---\n\nrun this\n"),
    "@pmcp/example",
    expected,
  );
  expect(substituted.matched).toBe(false);
  expect(substituted.actual).not.toBe(expected);
});

it("refuses an installed package that ships no skill at all", () => {
  const root = mkdtempSync(join(tmpdir(), "pmcp-verify-"));
  roots.push(root);
  mkdirSync(join(root, "node_modules/@pmcp/example"), { recursive: true });
  const check = verifyInstalledContent(
    root,
    "@pmcp/example",
    contentDigest(new Map()),
  );
  // An empty tree hashing to the expected empty digest must still not pass:
  // "nothing installed" is not "the content matched".
  expect(check).toMatchObject({ matched: false, skillCount: 0 });
});

it("refuses a package that is not installed", () => {
  const check = verifyInstalledContent(
    project(),
    "@pmcp/absent",
    contentDigest(new Map()),
  );
  expect(check).toMatchObject({ matched: false, skillCount: 0 });
});

it("agrees with the authoring side on the same tree", () => {
  const files = new Map([
    ["skills/a/SKILL.md", "alpha"],
    ["skills/b/SKILL.md", "beta"],
  ]);
  // The digest is length-delimited, so a path and a body cannot trade bytes.
  expect(contentDigest(files)).not.toBe(
    contentDigest(new Map([["skills/a/SKILL.mdalpha", ""]])),
  );
  expect(contentDigest(files)).toMatch(/^sha256:[a-f0-9]{64}$/u);
});
