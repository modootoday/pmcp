import { expect, it } from "vitest";
import { Ui } from "../src/cli/ui.js";
import { dispatch } from "../src/commands/index.js";

it("refuses stray words after list and models", async () => {
  for (const argv of [
    ["list", "nothing-here"],
    ["models", "extra"],
  ]) {
    const err: string[] = [];
    const ui = new Ui({
      stdout: { write: () => true },
      stderr: { write: (text) => err.push(text) },
      env: {},
    });
    expect(await dispatch(argv, { ui, env: {}, cwd: "/" })).toBe(2);
    expect(err.join("")).toContain(`unexpected ${argv[1]}`);
  }
});
