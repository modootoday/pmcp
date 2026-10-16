import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { createSkillTools } from "../src/server.js";

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function tools() {
  const root = mkdtempSync(join(tmpdir(), "short-name-"));
  const entry = (pkg: string, slug: string, description: string) => {
    const path = join(root, pkg, slug, "SKILL.md");
    write(
      path,
      `---\nname: ${slug}\ndescription: ${description}\n---\n\nBody of ${slug}.\n`,
    );
    return { name: `${pkg}/${slug}`, package: pkg, slug, description, path };
  };
  return createSkillTools({
    roots: [],
    loadCatalog: () => [
      entry(
        "acme/video",
        "tts-subtitle-sync",
        "Time captions to known narration.",
      ),
      entry(
        "acme/video",
        "subtitle-qc",
        "Check subtitle cue limits and reading speed for subtitles.",
      ),
      entry(
        "acme/audio",
        "voice-script",
        "Write a script for subtitles and narration read aloud.",
      ),
      entry("acme/one", "duplicate", "First of two skills with the same slug."),
      entry(
        "acme/two",
        "duplicate",
        "Second of two skills with the same slug.",
      ),
    ],
  });
}

describe("short skill names", () => {
  it("resolves a slug that ends exactly one full name, and answers with the full name", () => {
    const t = tools();
    expect(t.describe("tts-subtitle-sync")?.name).toBe(
      "acme/video/tts-subtitle-sync",
    );
    expect(t.describe("video/tts-subtitle-sync")?.name).toBe(
      "acme/video/tts-subtitle-sync",
    );
    expect(t.call("tts-subtitle-sync")?.name).toBe(
      "acme/video/tts-subtitle-sync",
    );
  });

  it("refuses a slug two skills share, and a partial slug", () => {
    const t = tools();
    expect(t.describe("duplicate")).toBeNull();
    expect(t.describe("subtitle-sync")).toBeNull();
  });

  it("puts a skill named in the request first, even when its description does not match", async () => {
    const result = await tools().find(
      "open the tts-subtitle-sync skill for my subtitles",
      3,
    );
    expect(result.matches[0]?.name).toBe("acme/video/tts-subtitle-sync");
    expect(result.matches).toHaveLength(3);
  });

  it("does not treat a longer word as a slug", async () => {
    const result = await tools().find(
      "pre-tts-subtitle-sync-check for subtitles",
      3,
    );
    expect(result.matches.map((m) => m.name)).not.toContain(
      "acme/video/tts-subtitle-sync",
    );
  });
});
