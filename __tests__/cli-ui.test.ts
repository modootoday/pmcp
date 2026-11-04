import { expect, it } from "vitest";
import { parseArgs } from "../src/cli/command.js";
import { asciiOnly, colourFrom, Ui } from "../src/cli/ui.js";

function sink(isTTY = false) {
  const chunks: string[] = [];
  return {
    chunks,
    stream: { write: (text: string) => chunks.push(text), isTTY },
  };
}

it("lets FORCE_COLOR override the terminal test both ways", () => {
  expect(colourFrom({}, true)).toBe(true);
  expect(colourFrom({}, false)).toBe(false);
  expect(colourFrom({ FORCE_COLOR: "0" }, true)).toBe(false);
  expect(colourFrom({ FORCE_COLOR: "false" }, true)).toBe(false);
  expect(colourFrom({ FORCE_COLOR: "1" }, false)).toBe(true);
  expect(colourFrom({ NO_COLOR: "1" }, true)).toBe(false);
  expect(colourFrom({ TERM: "dumb" }, true)).toBe(false);
});

it("prints ASCII for typographic characters on a dumb terminal or a non-UTF-8 locale", () => {
  expect(asciiOnly({})).toBe(false);
  expect(asciiOnly({ LANG: "en_US.UTF-8" })).toBe(false);
  expect(asciiOnly({ TERM: "dumb" })).toBe(true);
  expect(asciiOnly({ LC_ALL: "C" })).toBe(true);
  const err = sink();
  const ui = new Ui({ stderr: err.stream, env: { TERM: "dumb" } });
  ui.line("pmcp — a · b…");
  expect(err.chunks.join("")).toBe("pmcp - a / b...\n");
});

it("reports progress as plain lines every tenth when not a terminal", () => {
  const err = sink(false);
  const ui = new Ui({ stderr: err.stream, env: {} });
  const tick = ui.progress(20, "encoded");
  for (let done = 1; done <= 20; done += 1) tick(done);
  expect(err.chunks).toHaveLength(10);
  expect(err.chunks[0]).toBe("  2/20 encoded\n");
  expect(err.chunks.at(-1)).toBe("  20/20 encoded\n");
  expect(err.chunks.join("")).not.toContain("\r");
});

it("rewrites one line on a terminal and ends it once", () => {
  const err = sink(true);
  const ui = new Ui({ stderr: err.stream, env: {} });
  const tick = ui.progress(2, "encoded");
  tick(1);
  tick(2);
  expect(err.chunks[0]!.startsWith("\r  1/2 encoded")).toBe(true);
  expect(err.chunks[1]!.endsWith("\n")).toBe(true);
});

it("accepts a declared short flag", () => {
  const yes = { name: "yes", describe: "y", boolean: true, short: "y" };
  expect([...parseArgs(["-y"], [yes]).flags]).toEqual(["yes"]);
  expect(() => parseArgs(["-n"], [yes])).toThrow("unknown option -n");
});
