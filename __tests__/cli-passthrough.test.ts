import { expect, it } from "vitest";

import { parseArgs } from "../src/cli/command.js";

// A command line to run (pmcp heavy -- grep -q x) keeps its own -q and --help.
it("keeps the words after -- apart from the options", () => {
  const parsed = parseArgs(
    ["--label", "x", "--", "grep", "-q", "--help"],
    [{ name: "label", describe: "l", placeholder: "<t>" }],
  );
  expect(parsed.passthrough).toEqual(["grep", "-q", "--help"]);
  expect(parsed.positional).toEqual(["grep", "-q", "--help"]);
  expect(parseArgs(["a"]).passthrough).toBeUndefined();
});
