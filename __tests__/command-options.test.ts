import { expect, it } from "vitest";
import { COMMANDS } from "../src/commands/index.js";

/**
 * A command that spreads a shared option list and then declares one of the
 * same names again prints that flag twice in its own help, which reads as two
 * flags that differ. Nothing else notices: both entries are valid on their own.
 */
it("declares each option once per command", () => {
  const repeated: string[] = [];
  for (const command of COMMANDS) {
    const seen = new Set<string>();
    for (const option of command.options ?? []) {
      if (seen.has(option.name))
        repeated.push(`${command.name} --${option.name}`);
      seen.add(option.name);
    }
  }
  expect(repeated).toEqual([]);
  expect(COMMANDS.length).toBeGreaterThan(5);
});

it("describes every option it declares", () => {
  const undescribed: string[] = [];
  for (const command of COMMANDS) {
    for (const option of command.options ?? []) {
      if (!option.describe?.trim())
        undescribed.push(`${command.name} --${option.name}`);
    }
  }
  expect(undescribed).toEqual([]);
});
