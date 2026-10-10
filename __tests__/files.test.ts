import { describe, expect, it } from "vitest";

import { bundleSkill } from "../src/files/bundle.js";
import { readSkillFile } from "../src/files/read.js";
import { resolveSkillFileUri, skillFileUri } from "../src/files/uri.js";
import { classify } from "../src/mime.js";
import { LATIN1, PNG, WASM, skillTree } from "./fixtures/skill-tree.js";

describe("classify", () => {
  it("keeps text, image, audio and other binary apart", () => {
    expect(classify("a.md", new TextEncoder().encode("# x"))).toEqual({
      kind: "text",
      mimeType: "text/markdown",
    });
    expect(classify("a.png", PNG)).toEqual({
      kind: "image",
      mimeType: "image/png",
    });
    expect(classify("a.mp3", WASM)).toEqual({
      kind: "audio",
      mimeType: "audio/mpeg",
    });
    expect(classify("a.wasm", WASM)).toEqual({
      kind: "blob",
      mimeType: "application/wasm",
    });
  });

  it("serves a text-typed file that is not UTF-8 as a blob, so its digest stays exact", () => {
    expect(classify("a.md", LATIN1)).toEqual({
      kind: "blob",
      mimeType: "text/markdown",
    });
  });

  it("treats an unknown extension by its bytes", () => {
    expect(classify("Makefile", new TextEncoder().encode("all:\n")).kind).toBe(
      "text",
    );
    expect(classify("data.bin", WASM)).toEqual({
      kind: "blob",
      mimeType: "application/octet-stream",
    });
  });
});

describe("readSkillFile", () => {
  const { entries } = skillTree();
  const kit = entries[0]!;

  it("returns binary files as base64 that decodes to the original bytes", () => {
    const read = readSkillFile(kit, "assets/logo.png");
    expect(read.ok && read.kind).toBe("image");
    expect(read.ok && Buffer.from(read.blob!, "base64")).toEqual(
      Buffer.from(PNG),
    );
  });

  it("refuses paths outside the skill and files over the budget", () => {
    expect(readSkillFile(kit, "../vault/SKILL.md")).toMatchObject({
      ok: false,
      error: "path_outside_skill",
    });
    expect(readSkillFile(kit, "references/guide.md", 2)).toMatchObject({
      ok: false,
      error: "over_budget",
    });
  });
});

describe("bundleSkill", () => {
  it("lists every file with a skill:// URI and a media type, without bytes", () => {
    const { entries } = skillTree();
    const bundle = bundleSkill(entries[0]!);
    expect(bundle.files.map((f) => f.path)).toEqual([
      "assets/engine.wasm",
      "assets/logo.png",
      "assets/notes.md",
      "references/guide.md",
      "scripts/run.py",
      "SKILL.md",
    ]);
    const logo = bundle.files.find((f) => f.path === "assets/logo.png")!;
    expect(logo).toMatchObject({
      uri: "skill://pmcp/mp/plug/kit/assets/logo.png",
      mimeType: "image/png",
      bytes: PNG.length,
    });
    expect(JSON.stringify(bundle)).not.toContain("base64");
  });
});

describe("skill:// URIs", () => {
  it("resolves to the longest matching catalog name among the visible entries", () => {
    const { entries } = skillTree();
    const uri = skillFileUri(entries[0]!, "references/guide.md");
    expect(resolveSkillFileUri(uri, entries)).toMatchObject({
      entry: { slug: "kit" },
      file: "references/guide.md",
    });
    expect(resolveSkillFileUri(uri, [entries[1]!])).toBeNull();
  });
});
