import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { invocation } from "../src/cli/invocation.js";

it("names the way the reader actually started us", () => {
  // Measured on npm 11.12: npx sets npm_command to exec for the process it
  // spawns. Someone who followed the site has no pmcp on PATH to run.
  expect(invocation({ npm_command: "exec" })).toBe("npx -y @modootoday/pmcp");
  expect(invocation({})).toBe("pmcp");
  expect(invocation({ npm_command: "run-script" })).toBe("pmcp");
});

it("leaves no hint naming the bare command", () => {
  // A hint that hardcodes `pmcp` is a dead end for the documented path, and
  // reads as correct to anyone testing from a local checkout.
  const commands = join(import.meta.dirname, "../src/commands");
  const offenders: string[] = [];
  for (const name of readdirSync(commands)) {
    if (!name.endsWith(".ts")) continue;
    for (const [index, line] of readFileSync(join(commands, name), "utf8")
      .split("\n")
      .entries()) {
      // `usage` is the help synopsis, which names the command by design.
      if (/^\s*usage:/u.test(line)) continue;
      if (/\brun pmcp \w|"pmcp \w+ </u.test(line)) {
        offenders.push(`${name}:${index + 1}`);
      }
    }
  }
  expect(offenders).toEqual([]);
});
