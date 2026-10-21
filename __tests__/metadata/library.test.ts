import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  libraryProfile,
  validateManualLibraryIdentity,
} from "../../src/metadata/profiles/library.js";
import { parseFrontmatter } from "../../src/metadata/profiles/catalog-v1.js";

describe("library profile", () => {
  it("accepts every checked-in library skill", () => {
    let count = 0;
    for (const plugin of readdirSync(
      new URL("../../plugins/", import.meta.url),
    )) {
      if (plugin === "pmcp") continue;
      const dir = new URL(`../../plugins/${plugin}/skills/`, import.meta.url);
      let children: string[];
      try {
        children = readdirSync(dir);
      } catch {
        continue;
      }
      for (const child of children) {
        const { front } = parseFrontmatter(
          readFileSync(new URL(`${child}/SKILL.md`, dir), "utf8"),
        );
        expect(
          libraryProfile.safeParse(front).success,
          `${plugin}/${child}`,
        ).toBe(true);
        count++;
      }
    }
    expect(count).toBeGreaterThan(3);
  });
  it("matches manual identities including Go's v-prefixed versions", () => {
    const front = {
      name: "google-uuid",
      description: "manual",
      metadata: {
        ecosystem: "go",
        "target-identity": "github.com/google/uuid",
        "selected-version": "v1.6.0",
        loading: "manual",
      },
    };
    const descriptor = {
      ecosystem: "go",
      library: "github.com/google/uuid",
      version: "v1.6.0",
      path: "docs/skills/google-uuid/1/SKILL.md",
    };
    expect(validateManualLibraryIdentity(front, descriptor)).toBe(true);
    expect(
      validateManualLibraryIdentity(front, {
        ...descriptor,
        version: "v1.7.0",
      }),
    ).toBe(false);
  });
});
