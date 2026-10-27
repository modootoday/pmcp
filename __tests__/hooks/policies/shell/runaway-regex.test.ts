import { describe, expect, it } from "vitest";

import {
  nestedQuantifier,
  repetitionCounts,
} from "../../../../src/hooks/policies/shell/regex-cost.js";
import { runawayRegex } from "../../../../src/hooks/policies/shell/runaway-regex.js";
import { compiled, guard, runShell } from "../../helpers.js";

const TODAY = "grep -o '\\[hook\\] Summary.\\{0,2500\\}' big.output";

const verdict = async (
  command: string,
  options: Record<string, unknown> = {},
) =>
  (
    await runShell(
      "claude",
      compiled([guard("shell.runaway_regex", "deny", options)]),
      command,
    )
  ).verdict;

describe("shell.runaway_regex", () => {
  it("says how to find the text instead", async () => {
    const outcome = await runShell(
      "claude",
      compiled([guard("shell.runaway_regex")]),
      TODAY,
    );
    expect(outcome.stdout).toMatch(/a repetition count of 2500/u);
    for (const hint of ["grep -n", "sed -n 'N,+K p'", "rg", "timeout 20"])
      expect(outcome.stdout).toContain(hint);
  });

  it("takes the threshold from its options", async () => {
    const small = "grep -o 'x.\\{0,200\\}' big.output";
    expect(await verdict(small)).toBeUndefined();
    expect(await verdict(small, { threshold: 100 })).toBe("deny");
    expect(await verdict(TODAY, { threshold: 4000 })).toBeUndefined();
  });

  it("flags -o with more than one .* only when asked to", async () => {
    const wide = "grep -o -E '.*foo.*' big.output";
    expect(await verdict(wide)).toBeUndefined();
    expect(await verdict(wide, { only_matching_wildcards: true })).toBe("deny");
    expect(
      await verdict("grep -E '.*foo.*' big.output", {
        only_matching_wildcards: true,
      }),
    ).toBeUndefined();
  });

  it("lets a timeout-bounded grep through unless allow_timeout is false", async () => {
    const timed = `timeout 20 ${TODAY}`;
    expect(await verdict(timed)).toBeUndefined();
    expect(await verdict(timed, { allow_timeout: false })).toBe("deny");
  });

  it("rejects options it does not know or cannot use", () => {
    expect(() => runawayRegex.options({ threshold: 0 })).toThrow(
      "threshold must be an integer",
    );
    expect(() => runawayRegex.options({ allow_timeout: "yes" })).toThrow(
      "allow_timeout must be true or false",
    );
    expect(() => runawayRegex.options({ limit: 3 })).toThrow();
  });

  it("reads counts by syntax and finds nested quantifiers outside classes", () => {
    expect(repetitionCounts("a\\{2,3000\\}", "basic")).toEqual([2, 3000]);
    expect(repetitionCounts("a{2,3000}", "basic")).toEqual([]);
    expect(repetitionCounts("a\\{9000}b{,700}", "extended")).toEqual([700]);
    expect(nestedQuantifier("(a+)+")).toBe(true);
    expect(nestedQuantifier("(?:x*y){2,}")).toBe(true);
    expect(nestedQuantifier("(a+)b")).toBe(false);
    expect(nestedQuantifier("[(a+)]+")).toBe(false);
    expect(nestedQuantifier("\\(a+\\)+")).toBe(false);
  });
});
