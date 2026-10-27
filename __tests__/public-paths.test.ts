import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

// The repository is public. Design decisions, plans and specifications of the projects that use
// pmcp are kept in those projects, never here; only code, user-facing docs and tests are.
const PRIVATE_RECORD =
  /(?:^|\/)(?:\.spec|adrs?|decisions)(?:\/|$)|(?:^|\/)ADR-[A-Z]+-\d+/iu;

function privateRecords(paths: readonly string[]): string[] {
  return paths.filter((path) => PRIVATE_RECORD.test(path));
}

it("tracks no decision record, plan or specification path", () => {
  const tracked = execFileSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  expect(privateRecords(tracked)).toEqual([]);
});

it("knows the shapes it refuses", () => {
  expect(
    privateRecords([
      "docs/adr/0001-generality.md",
      ".spec/plans/x.md",
      "apps/web/.spec/sots/a.sot.md",
      "docs/decisions/2026-ci.md",
      "notes/ADR-OPS-7-x.md",
      "docs/git-workflow.md",
      "src/hooks/policies/shell/regex-cost.ts",
      "docs/hooks/adrenaline.md",
    ]),
  ).toEqual([
    "docs/adr/0001-generality.md",
    ".spec/plans/x.md",
    "apps/web/.spec/sots/a.sot.md",
    "docs/decisions/2026-ci.md",
    "notes/ADR-OPS-7-x.md",
  ]);
});
