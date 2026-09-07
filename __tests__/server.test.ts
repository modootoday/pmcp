import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { createSkillTools } from "../src/server.js";

const root = mkdtempSync(join(tmpdir(), "skill-tools-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const modules = join(root, "node_modules");

function makeSkill(
  pkg: string,
  slug: string,
  description: string,
  body: string,
): void {
  const dir = join(modules, pkg.replace("@acme/", ""), ".agent/skills", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(modules, pkg.replace("@acme/", ""), "package.json"),
    JSON.stringify({ name: pkg }),
  );
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${slug}\ndescription: ${description}\n---\n\n${body}\n`,
  );
}

makeSkill(
  "@acme/runner",
  "adoption",
  "Wire the stage runner",
  "Install it, then call run.",
);
makeSkill(
  "@acme/clock",
  "adoption",
  "Deterministic time for tests",
  "Inject the Clock.",
);

const tools = () => createSkillTools({ roots: [modules] });

describe("catalog", () => {
  it("groups by package and counts every skill", () => {
    const result = tools().catalog();
    expect(result.count).toBe(2);
    expect(result.packages.map((p) => p.package)).toEqual([
      "@acme/clock",
      "@acme/runner",
    ]);
  });

  // The whole point: the overview never carries bodies, so listing costs the
  // session a description rather than a document.
  it("carries no body", () => {
    expect(JSON.stringify(tools().catalog())).not.toContain("Inject the Clock");
  });
});

describe("find", () => {
  it("returns names and scores, not bodies", async () => {
    const result = await tools().find("stage runner");
    expect(result.matches[0]?.name).toBe("@acme/runner/adoption");
    expect(JSON.stringify(result)).not.toContain("Install it, then call run.");
  });

  it("says which ranking answered", async () => {
    expect((await tools().find("stage runner")).ranking).toBe("lexical");
  });
});

describe("call", () => {
  it("returns one body", () => {
    expect(tools().call("@acme/runner/adoption")?.body.trim()).toBe(
      "Install it, then call run.",
    );
  });

  it("returns the body without its frontmatter", () => {
    expect(tools().call("@acme/runner/adoption")?.body).not.toContain(
      "description:",
    );
  });

  it("returns null for a name that is not in the catalog", () => {
    expect(tools().call("@acme/nothing/adoption")).toBeNull();
  });
});

describe("the catalog is read once per server", () => {
  it("does not re-walk the tree on every call", () => {
    let loads = 0;
    const counting = createSkillTools({
      roots: [modules],
      loadCatalog: (options) => {
        loads += 1;
        return [
          {
            name: "@acme/x/y",
            package: "@acme/x",
            slug: "y",
            description: "d",
            path: join(options.roots[0]!, "nothing"),
          },
        ];
      },
    });
    counting.catalog();
    counting.catalog();
    void counting.find("d");
    expect(loads).toBe(1);
  });

  it("re-reads after refresh, because installing a package changes the answer", () => {
    let loads = 0;
    const counting = createSkillTools({
      roots: [modules],
      loadCatalog: () => {
        loads += 1;
        return [];
      },
    });
    counting.catalog();
    counting.refresh();
    counting.catalog();
    expect(loads).toBe(2);
  });
});
