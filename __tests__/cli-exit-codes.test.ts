import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { EXIT } from "../src/cli/command.js";

it("publishes every exit code in one table, drift apart from usage", () => {
  expect(EXIT).toEqual({
    ok: 0,
    failure: 1,
    usage: 2,
    missingOptional: 3,
    differences: 4,
    busy: 75,
  });
  const doc = readFileSync(
    join(import.meta.dirname, "../docs/commands.md"),
    "utf8",
  );
  const table = doc.slice(doc.indexOf("## Exit codes"));
  for (const code of Object.values(EXIT)) {
    expect(table).toMatch(new RegExp(`^\\| \`${code}\` +\\|`, "mu"));
  }
});
