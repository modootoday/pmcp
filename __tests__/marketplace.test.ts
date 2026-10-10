import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { readCatalog } from "../src/catalog.js";
import { readMarketplace, readMetadata } from "../src/marketplace.js";
import { READ_BUDGET_BYTES, createSkillTools } from "../src/server.js";

const root = mkdtempSync(join(tmpdir(), "pmcp-marketplace-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function write(path: string, contents: string | Buffer): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents);
}

function skill(
  name: string,
  description: string,
  metadata: string[] = [],
): string {
  const block =
    metadata.length > 0
      ? `metadata:\n${metadata.map((l) => `  ${l}`).join("\n")}\n`
      : "";
  return `---\nname: ${name}\ndescription: ${description}\n${block}---\n\n# ${name}\n\nSee references/guide.md.\n`;
}

function marketplace(
  dir: string,
  name: string,
  tier: string | undefined,
  plugins: string[],
): void {
  write(
    join(dir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name,
      ...(tier ? { metadata: { tier } } : {}),
      plugins: plugins.map((plugin) => ({
        name: plugin,
        source: `./plugins/${plugin}`,
      })),
    }),
  );
}

const open = join(root, "open");
marketplace(open, "acme", "open", ["release-notes", "audio"]);
write(
  join(open, "plugins/release-notes/skills/changelog-draft/SKILL.md"),
  skill(
    "changelog-draft",
    "Draft a changelog entry from merged pull requests.",
    [
      "tier: open",
      "level: L2",
      "domain: product-planning",
      "keywords: [version history, release notes]",
    ],
  ),
);
write(
  join(
    open,
    "plugins/release-notes/skills/changelog-draft/references/guide.md",
  ),
  "# guide\n",
);
write(
  join(open, "plugins/release-notes/skills/leaky/SKILL.md"),
  skill("leaky", "A private skill that was copied into the public tree.", [
    "tier: free",
  ]),
);
write(
  join(open, "plugins/audio/skills/sfx-library/SKILL.md"),
  skill(
    "sfx-library",
    "Build a licensed sound effects library for short videos.",
    ["level: L3", "medium: sfx"],
  ),
);
write(
  join(open, "plugins/audio/skills/sfx-library/big.bin"),
  Buffer.alloc(READ_BUDGET_BYTES + 1),
);
write(join(root, "secret.txt"), "outside\n");
symlinkSync(
  join(root, "secret.txt"),
  join(open, "plugins/audio/skills/sfx-library/escape.txt"),
);

const free = join(root, "free");
marketplace(free, "acme-free", "free", ["billing"]);
write(
  join(free, "plugins/billing/skills/invoice-review/SKILL.md"),
  skill("invoice-review", "Review an invoice batch for duplicate charges.", [
    "tier: free",
  ]),
);

describe("readMetadata", () => {
  it("reads one nested level of scalars and inline lists", () => {
    const meta = readMetadata(
      skill("x", "y", [
        "tier: open",
        "level: L2",
        "keywords: [a, 'b c']",
        "requires:",
        "    gpu-gb: 8",
      ]),
    );
    expect(meta).toEqual({
      tier: "open",
      level: "L2",
      keywords: ["a", "b c"],
      requires: { "gpu-gb": "8" },
    });
  });

  it("returns nothing without a metadata block", () => {
    expect(readMetadata(skill("x", "y"))).toEqual({});
  });
});

describe("readMarketplace", () => {
  it("names skills marketplace/plugin/skill and inherits the marketplace tier", () => {
    const rejected: string[] = [];
    const entries = readMarketplace(open, (r) => rejected.push(r.reason));
    expect(entries.map((e) => [e.name, e.tier])).toEqual([
      ["acme/release-notes/changelog-draft", "open"],
      ["acme/audio/sfx-library", "open"],
    ]);
    expect(rejected).toEqual(["metadata.tier free in a open marketplace"]);
  });

  it("returns nothing for a directory without marketplace.json and says why", () => {
    const rejected: string[] = [];
    expect(
      readMarketplace(join(root, "nowhere"), (r) => rejected.push(r.reason)),
    ).toEqual([]);
    expect(rejected).toEqual(["no .claude-plugin/marketplace.json here"]);
  });
});

describe("readCatalog with marketplaces", () => {
  it("merges every marketplace given and keeps node_modules roots optional", () => {
    const entries = readCatalog({
      roots: [join(root, "no-modules")],
      marketplaces: [open, free],
    });
    expect(entries.map((e) => e.name)).toEqual([
      "acme-free/billing/invoice-review",
      "acme/audio/sfx-library",
      "acme/release-notes/changelog-draft",
    ]);
  });
});

const tools = createSkillTools({ roots: [], marketplaces: [open, free] });

describe("catalog paging and tier", () => {
  it("filters by tier and pages by group", () => {
    const freeOnly = tools.catalog({ tier: "free" });
    expect(freeOnly.count).toBe(1);
    const first = tools.catalog({ pageSize: 1 });
    expect(first).toMatchObject({ page: 1, totalPages: 3, hasNext: true });
    expect(tools.catalog({ pageSize: 1, page: 9 }).page).toBe(3);
  });
});

describe("find filters and keywords", () => {
  it("ranks keywords but returns the plain description", async () => {
    // Only the keyword carries "version history"; the description never says it.
    const result = await tools.find("version history", 3);
    expect(result.matches[0]?.name).toBe("acme/release-notes/changelog-draft");
    expect(result.matches[0]?.description).toBe(
      "Draft a changelog entry from merged pull requests.",
    );
  });

  it("applies filters before ranking", async () => {
    const result = await tools.find("sound effects for short videos", 5, {
      medium: "sfx",
      tier: "free",
    });
    expect(result.matches).toEqual([]);
  });
});

describe("describe", () => {
  it("lists files with digests that match the bytes", () => {
    const d = tools.describe("acme/release-notes/changelog-draft")!;
    expect(d.metadata).toMatchObject({
      level: "L2",
      domain: "product-planning",
    });
    const guide = d.files.find((f) => f.path === "references/guide.md")!;
    expect(guide.sha256).toBe(
      createHash("sha256").update("# guide\n").digest("hex"),
    );
    expect(tools.describe("acme/nope")).toBeNull();
  });
});

describe("read", () => {
  it("reads a reference file inside the skill", () => {
    const r = tools.read(
      "acme/release-notes/changelog-draft",
      "references/guide.md",
    );
    expect(r).toMatchObject({
      ok: true,
      path: "references/guide.md",
      text: "# guide\n",
    });
  });

  it("refuses parent paths, absolute paths, links out and oversize files", () => {
    const name = "acme/audio/sfx-library";
    expect(
      tools.read(name, "../../release-notes/skills/changelog-draft/SKILL.md"),
    ).toMatchObject({ error: "path_outside_skill" });
    expect(tools.read(name, join(root, "secret.txt"))).toMatchObject({
      error: "path_outside_skill",
    });
    expect(tools.read(name, "escape.txt")).toMatchObject({
      error: "path_outside_skill",
    });
    expect(tools.read(name, "big.bin")).toMatchObject({ error: "over_budget" });
    expect(tools.read(name, "missing.md")).toMatchObject({
      error: "no_such_file",
    });
  });
});
