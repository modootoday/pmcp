import { afterEach, expect, it, vi } from "vitest";
import { parseArgs } from "../src/cli/command.js";
import { Ui } from "../src/cli/ui.js";
import { dispatch } from "../src/commands/index.js";
import { VERSION } from "../src/commands/version.js";

const serve = vi.hoisted(() => vi.fn(() => 0));
vi.mock("../src/commands/serve.js", () => ({
  serveCommand: {
    name: "serve",
    describe: "MCP",
    usage: "pmcp serve",
    run: serve,
    options: [{ name: "root", describe: "root", placeholder: "<dir>" }],
  },
}));
afterEach(() => vi.clearAllMocks());

async function capture(argv: readonly string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const ui = new Ui({
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
  });
  const code = await dispatch(argv, {
    ui,
    env: {},
    cwd: "/",
    terminal: { stdin: false, stdout: false },
  });
  return { code, out: out.join(""), err: err.join("") };
}

it.each([["--version"], ["-v"], ["-V"], ["version"]])(
  "prints the version for %s",
  async (word) => {
    expect(await capture([word])).toEqual({
      code: 0,
      out: `${VERSION}\n`,
      err: "",
    });
  },
);

it("refuses words after the version flag", async () => {
  const result = await capture(["--version", "extra"]);
  expect(result.code).toBe(2);
  expect(result.out).toBe("");
  expect(result.err).toContain("--version takes no arguments, got extra");
});

it.each([["-x"], ["-j"], ["--verison"], ["--jsno=1"]])(
  "refuses %s as a leading option without starting the server",
  async (word) => {
    const result = await capture([word]);
    expect(result.code).toBe(2);
    expect(result.out).toBe("");
    expect(result.err).toContain(`unknown option ${word.split("=")[0]}`);
    expect(serve).not.toHaveBeenCalled();
  },
);

it("still serves when the leading option is a server option", async () => {
  expect((await capture(["--root", "/catalog"])).code).toBe(0);
  expect((await capture(["--root=/catalog"])).code).toBe(0);
  expect(serve).toHaveBeenCalledTimes(2);
});

it("rejects an undeclared short flag inside a command", () => {
  expect(() => parseArgs(["-j"])).toThrow("unknown option -j");
  expect(parseArgs(["-", "-5"]).positional).toEqual(["-", "-5"]);
  expect(parseArgs(["--", "-j"]).positional).toEqual(["-j"]);
});
