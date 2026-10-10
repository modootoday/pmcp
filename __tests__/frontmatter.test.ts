import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  bodyOf,
  frontmatterObject,
  metadataOf,
  specProblems,
  stringFields,
} from "../src/frontmatter.js";
import { validateSkillDir } from "../src/validate.js";

describe("frontmatterObject", () => {
  it("parses block scalars, a BOM and CRLF line endings", () => {
    const source =
      "﻿---\r\nname: a\r\ndescription: |\r\n  one\r\n  two\r\n---\r\nBody\r\n";
    expect(stringFields(frontmatterObject(source))).toEqual({
      name: "a",
      description: "one\ntwo",
    });
    expect(bodyOf(source)).toBe("Body\n");
  });

  it("recovers an unquoted value that contains a colon", () => {
    const front = frontmatterObject(
      "---\nname: a\ndescription: Use it: when testing\n---\n",
    );
    expect(front?.["description"]).toBe("Use it: when testing");
  });

  it("reads metadata one level deep as strings and string lists", () => {
    const front = frontmatterObject(
      "---\nname: a\ndescription: d\nmetadata:\n  level: 2\n  tags: [x, y]\n---\n",
    );
    expect(metadataOf(front)).toEqual({ level: "2", tags: ["x", "y"] });
  });

  it("keeps a map one level below metadata and drops anything deeper", () => {
    const front = frontmatterObject(
      [
        "---",
        "name: a",
        "description: d",
        "metadata:",
        "  level: 2",
        "  requires:",
        "    mcp: [skills, runpod]",
        "    bin: node",
        "    gpu-gb: 24",
        "    deep:",
        "      too: far",
        "  empty:",
        "    nested:",
        "      only: deep",
        "---",
        "",
      ].join("\n"),
    );
    expect(metadataOf(front)).toEqual({
      level: "2",
      requires: { mcp: ["skills", "runpod"], bin: "node", "gpu-gb": "24" },
    });
  });
});

describe("specProblems", () => {
  const valid = { name: "pdf-tools", description: "Works with PDFs." };

  it("accepts a valid skill", () => {
    expect(specProblems(valid, "pdf-tools")).toEqual([]);
  });

  it("names each rule the specification sets", () => {
    expect(
      specProblems({ ...valid, name: "PDF--Tools" }, "PDF--Tools"),
    ).toContain(
      "name must be lowercase letters, digits and single hyphens, not starting or ending with one",
    );
    expect(
      specProblems({ ...valid, name: "a".repeat(65) }, "a".repeat(65)),
    ).toContain("name is longer than 64 characters");
    expect(specProblems(valid, "pdf")).toContain(
      "name pdf-tools does not match its directory pdf",
    );
    expect(
      specProblems({ ...valid, description: "x".repeat(1025) }, "pdf-tools"),
    ).toContain("description is longer than 1024 characters");
    expect(
      specProblems({ ...valid, compatibility: "x".repeat(501) }, "pdf-tools"),
    ).toContain("compatibility is longer than 500 characters");
    expect(specProblems({ ...valid, metadata: "flat" }, "pdf-tools")).toContain(
      "metadata must be a map",
    );
  });
});

describe("validateSkillDir", () => {
  it("reports a directory without SKILL.md and a skill whose name differs from its folder", () => {
    const root = mkdtempSync(join(tmpdir(), "pmcp-validate-"));
    mkdirSync(join(root, "empty"));
    mkdirSync(join(root, "tools"));
    writeFileSync(
      join(root, "tools", "SKILL.md"),
      "---\nname: tooling\ndescription: d\n---\n",
    );
    expect(validateSkillDir(join(root, "empty"))[0]?.reason).toBe(
      "no SKILL.md",
    );
    expect(validateSkillDir(join(root, "tools")).map((f) => f.reason)).toEqual([
      "name tooling does not match its directory tools",
    ]);
  });
});
