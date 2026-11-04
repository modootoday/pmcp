import { expect, it } from "vitest";
import { Ui } from "../src/cli/ui.js";
import { dispatch } from "../src/commands/index.js";

async function capture(argv: readonly string[], quiet = false) {
  const out: string[] = [];
  const err: string[] = [];
  const ui = new Ui({
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
    env: {},
    quiet,
  });
  const code = await dispatch(argv, { ui, env: {}, cwd: "/" });
  return { code, out: out.join(""), err: err.join("") };
}

it("prints a command's result on stdout, even under -q", async () => {
  for (const quiet of [false, true]) {
    const result = await capture(["models"], quiet);
    expect(result.code).toBe(0);
    expect(result.out).toContain("e5-small");
    expect(result.err).toBe("");
  }
});

it("prints requested help on stdout and errors on stderr", async () => {
  const help = await capture(["list", "--help"]);
  expect(help.out).toContain("pmcp list");
  expect(help.err).toBe("");
  const quietHelp = await capture(["--help"], true);
  expect(quietHelp.out).toContain("pmcp");
  const error = await capture(["list", "--nosuch"], true);
  expect(error.code).toBe(2);
  expect(error.out).toBe("");
  expect(error.err).toContain("unknown option --nosuch");
});

it("keeps the result view uncoloured when stdout is not a terminal", () => {
  const ui = new Ui({
    stdout: { write: () => true, isTTY: false },
    stderr: { write: () => true, isTTY: true },
    env: {},
  });
  expect(ui.colour).toBe(true);
  expect(ui.results.colour).toBe(false);
});

it("wraps a result table on a terminal that reports no width at 80", () => {
  const ui = new Ui({ stdout: { write: () => true, isTTY: true }, env: {} });
  expect(ui.results.width("table")).toBe(80);
});
