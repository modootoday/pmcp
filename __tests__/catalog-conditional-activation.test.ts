import { describe, expect, it, vi } from "vitest";

import {
  createPathMatcher,
  extractEntryConditions,
  isConditionalEntry,
  loadConditionalEntries,
  loadConditionalEntriesSync,
  matchConditionalEntries,
  matchEntry,
  type ConditionalCandidate,
} from "../src/catalog/conditional.js";
import type { SkillEntry } from "../src/catalog/types.js";

describe("extractEntryConditions", () => {
  it("extracts globs and paths from metadata fields", () => {
    const entry: ConditionalCandidate = {
      name: "test-skill",
      metadata: {
        globs: ["src/**/*.ts", "packages/**/*.json"],
        paths: "docs/readme.md",
      },
    };
    const extracted = extractEntryConditions(entry);
    expect(extracted.isConditional).toBe(true);
    expect(extracted.always).toBe(false);
    expect(extracted.patterns).toContain("src/**/*.ts");
    expect(extracted.patterns).toContain("packages/**/*.json");
    expect(extracted.patterns).toContain("docs/readme.md");
  });

  it("extracts top-level globs and paths", () => {
    const entry: ConditionalCandidate = {
      name: "top-level",
      globs: ["apps/**"],
      paths: ["package.json"],
    };
    const extracted = extractEntryConditions(entry);
    expect(extracted.isConditional).toBe(true);
    expect(extracted.patterns).toEqual(["apps/**", "package.json"]);
  });

  it("extracts nested activation and when patterns", () => {
    const entry: ConditionalCandidate = {
      name: "nested-conditions",
      when: { globs: ["backend/**/*.go"] },
      metadata: {
        activation: {
          paths: ["config/server.yaml"],
        },
      },
    };
    const extracted = extractEntryConditions(entry);
    expect(extracted.isConditional).toBe(true);
    expect(extracted.patterns).toContain("backend/**/*.go");
    expect(extracted.patterns).toContain("config/server.yaml");
  });

  it("expands brace expressions while preserving negative rule prefixes", () => {
    const entry: ConditionalCandidate = {
      name: "brace-expansion",
      globs: ["src/{api,web}/**/*.ts", "!tests/{unit,e2e}/**/*.ts"],
    };
    const extracted = extractEntryConditions(entry);
    expect(extracted.patterns).toContain("src/api/**/*.ts");
    expect(extracted.patterns).toContain("src/web/**/*.ts");
    expect(extracted.patterns).toContain("!tests/unit/**/*.ts");
    expect(extracted.patterns).toContain("!tests/e2e/**/*.ts");
  });

  it("detects always-active entries", () => {
    const entry: ConditionalCandidate = {
      name: "always-skill",
      activation: "always",
    };
    const extracted = extractEntryConditions(entry);
    expect(extracted.always).toBe(true);
  });
});

describe("createPathMatcher", () => {
  it("matches recursive file globs", () => {
    const matcher = createPathMatcher(["src/**/*.ts"]);
    expect(matcher("src/index.ts")).toBe(true);
    expect(matcher("src/nested/deep/file.ts")).toBe(true);
    expect(matcher("src/index.js")).toBe(false);
    expect(matcher("docs/readme.md")).toBe(false);
  });

  it("matches directory prefixes for non-wildcard directory paths", () => {
    const matcher = createPathMatcher(["packages/core"]);
    expect(matcher("packages/core")).toBe(true);
    expect(matcher("packages/core/src/index.ts")).toBe(true);
    expect(matcher("packages/other/src/index.ts")).toBe(false);
  });

  it("applies ordered negation exclusion rules", () => {
    const matcher = createPathMatcher(["src/**/*.ts", "!src/**/*.test.ts"]);
    expect(matcher("src/app.ts")).toBe(true);
    expect(matcher("src/app.test.ts")).toBe(false);
  });

  it("returns false when given no patterns", () => {
    const matcher = createPathMatcher([]);
    expect(matcher("src/index.ts")).toBe(false);
  });
});

describe("isConditionalEntry", () => {
  it("returns true for entries with path criteria and false for unconditional entries", () => {
    expect(isConditionalEntry({ name: "a", globs: ["*.py"] })).toBe(true);
    expect(isConditionalEntry({ name: "b" })).toBe(false);
  });
});

describe("matchEntry", () => {
  const pythonSkill: ConditionalCandidate = {
    name: "python-helper",
    metadata: { globs: ["**/*.py"] },
  };

  const dbMcp: ConditionalCandidate = {
    name: "db-mcp",
    kind: "mcp",
    metadata: {
      paths: ["data/migrations", "src/db/**/*.ts"],
    },
  };

  const generalSkill: ConditionalCandidate = {
    name: "general-helper",
  };

  it("matches when active file path satisfies glob condition", () => {
    expect(matchEntry(pythonSkill, ["src/app/main.py"])).toBe(true);
    expect(matchEntry(pythonSkill, ["src/app/main.ts"])).toBe(false);
  });

  it("matches directory prefixes and nested file globs", () => {
    expect(matchEntry(dbMcp, ["data/migrations/001_init.sql"])).toBe(true);
    expect(matchEntry(dbMcp, ["src/db/client.ts"])).toBe(true);
    expect(matchEntry(dbMcp, ["src/ui/button.tsx"])).toBe(false);
  });

  it("matches against active workspace globs", () => {
    expect(
      matchEntry(pythonSkill, {
        activeGlobs: ["src/**/*.py"],
      }),
    ).toBe(true);
    expect(
      matchEntry(pythonSkill, {
        activeGlobs: ["docs/**"],
      }),
    ).toBe(false);
  });

  it("filters entries by kind", () => {
    expect(
      matchEntry(dbMcp, { activePaths: ["src/db/client.ts"], kind: "mcp" }),
    ).toBe(true);
    expect(
      matchEntry(dbMcp, { activePaths: ["src/db/client.ts"], kind: "skill" }),
    ).toBe(false);
  });

  it("excludes unconditional entries by default and includes them when requested", () => {
    expect(matchEntry(generalSkill, ["src/index.ts"])).toBe(false);
    expect(
      matchEntry(generalSkill, {
        activePaths: ["src/index.ts"],
        includeUnconditional: true,
      }),
    ).toBe(true);
  });

  it("always matches entries with always activation mode", () => {
    const alwaysEntry: ConditionalCandidate = {
      name: "global-guide",
      metadata: { always: true },
    };
    expect(matchEntry(alwaysEntry, [])).toBe(true);
    expect(matchEntry(alwaysEntry, ["unrelated.txt"])).toBe(true);
  });

  it("normalizes path separators and strips configured root prefix", () => {
    const tsSkill: ConditionalCandidate = {
      name: "ts-skill",
      globs: ["src/**/*.ts"],
    };
    expect(matchEntry(tsSkill, ["src\\nested\\file.ts"])).toBe(true);
    expect(matchEntry(tsSkill, ["./src/nested/file.ts"])).toBe(true);
    expect(
      matchEntry(tsSkill, {
        activePaths: ["/repo/root/src/index.ts"],
        root: "/repo/root",
      }),
    ).toBe(true);
  });
});

describe("matchConditionalEntries", () => {
  const candidates: SkillEntry[] = [
    {
      name: "python-linter",
      package: "@tools/python",
      slug: "linter",
      description: "Python linter",
      path: "/tools/python/SKILL.md",
      metadata: { globs: ["**/*.py"] },
    },
    {
      name: "rust-builder",
      package: "@tools/rust",
      slug: "builder",
      description: "Rust builder",
      path: "/tools/rust/SKILL.md",
      metadata: { globs: ["**/*.rs", "Cargo.toml"] },
    },
    {
      name: "sql-migrator",
      package: "@tools/sql",
      slug: "migrator",
      description: "SQL migration helper",
      path: "/tools/sql/SKILL.md",
      metadata: { paths: ["data/migrations"] },
    },
  ];

  it("filters candidates returning only relevant entries", () => {
    const matched = matchConditionalEntries(candidates, ["src/main.rs"]);
    expect(matched.map((e) => e.name)).toEqual(["rust-builder"]);
  });

  it("returns multiple matching entries across different files", () => {
    const matched = matchConditionalEntries(candidates, [
      "src/server.py",
      "data/migrations/002.sql",
    ]);
    expect(matched.map((e) => e.name)).toEqual([
      "python-linter",
      "sql-migrator",
    ]);
  });

  it("returns empty list when no entries match active paths", () => {
    const matched = matchConditionalEntries(candidates, ["README.md"]);
    expect(matched).toEqual([]);
  });
});

describe("lazy activation via loadConditionalEntries", () => {
  it("does not load unrelated skills and invokes load only for matching entries", async () => {
    const loadRust = vi
      .fn()
      .mockResolvedValue({ name: "rust-tool", loaded: true });
    const loadPy = vi.fn().mockResolvedValue({ name: "py-tool", loaded: true });
    const loadSql = vi
      .fn()
      .mockResolvedValue({ name: "sql-tool", loaded: true });

    const lazyEntries = [
      { name: "rust-tool", globs: ["**/*.rs"], load: loadRust },
      { name: "py-tool", globs: ["**/*.py"], load: loadPy },
      { name: "sql-tool", paths: ["migrations"], load: loadSql },
    ];

    const results = await loadConditionalEntries(lazyEntries, [
      "crates/core/src/lib.rs",
    ]);

    expect(loadRust).toHaveBeenCalledTimes(1);
    expect(loadPy).not.toHaveBeenCalled();
    expect(loadSql).not.toHaveBeenCalled();
    expect(results).toEqual([{ name: "rust-tool", loaded: true }]);
  });

  it("supports synchronous lazy activation via loadConditionalEntriesSync", () => {
    const loadJs = vi.fn().mockReturnValue({ name: "js-tool", loaded: true });
    const loadGo = vi.fn().mockReturnValue({ name: "go-tool", loaded: true });

    const lazyEntries = [
      { name: "js-tool", globs: ["src/**/*.{js,ts}"], load: loadJs },
      { name: "go-tool", globs: ["**/*.go"], load: loadGo },
    ];

    const results = loadConditionalEntriesSync(lazyEntries, ["src/index.ts"]);

    expect(loadJs).toHaveBeenCalledTimes(1);
    expect(loadGo).not.toHaveBeenCalled();
    expect(results).toEqual([{ name: "js-tool", loaded: true }]);
  });
});
