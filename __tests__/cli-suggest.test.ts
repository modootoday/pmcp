import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { NO_CONFIG, parseArgs } from "../src/cli/command.js";
import { closest, distance } from "../src/cli/suggest.js";
import { Ui } from "../src/cli/ui.js";
import { dispatch } from "../src/commands/index.js";

const empty = mkdtempSync(join(tmpdir(), "pmcp-suggest-"));
afterAll(() => rmSync(empty, { recursive: true, force: true }));

async function capture(argv: readonly string[], cwd = "/") {
  const out: string[] = [];
  const err: string[] = [];
  const ui = new Ui({
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
  });
  const code = await dispatch(argv, { ui, env: {}, cwd });
  return { code, out: out.join(""), err: err.join("") };
}

it("measures edit distance and keeps short words to one edit", () => {
  expect(distance("stauts", "status")).toBe(2);
  expect(distance("", "abc")).toBe(3);
  expect(closest("lst", ["list", "logs"])).toBe("list");
  expect(closest("ls", ["mcp", "git"])).toBeUndefined();
  expect(closest("market", ["marketplace"])).toBe("marketplace");
});

it.each([
  ["stauts", "status"],
  ["lst", "list"],
  ["hoks", "hooks"],
])(
  "suggests a command for %s without printing the whole help",
  async (typo, meant) => {
    const result = await capture([typo]);
    expect(result.code).toBe(2);
    expect(result.err).toContain(
      `unknown command "${typo}"; did you mean "${meant}"?`,
    );
    expect(result.err).toContain("Run pmcp --help for the commands.");
    expect(result.err.split("\n").length).toBeLessThan(5);
  },
);

it("treats help for an unknown command as a usage error", async () => {
  const result = await capture(["help", "nosuch"]);
  expect(result.code).toBe(2);
  expect(result.err).toContain('unknown command "nosuch"');
});

it("suggests a flag the command declares", () => {
  expect(() =>
    parseArgs(["--jsno"], [{ name: "json", describe: "j", boolean: true }]),
  ).toThrow("unknown option --jsno; did you mean --json?");
});

it("names every subcommand and the closest one", async () => {
  const project = await capture(["project", "bogus"], empty);
  expect(project.code).toBe(2);
  expect(project.err).toContain(
    'unknown project subcommand "bogus"; choose one of: add, remove, import-mcp, exec-mcp',
  );
  const sessions = await capture(["sessions", "stauts"], empty);
  expect(sessions.err).toContain(
    'unknown sessions subcommand "stauts"; did you mean "status"?',
  );
  const hooks = await capture(["hooks", "lsit"], empty);
  expect(hooks.err).toContain('did you mean "list"?');
  const git = await capture(["git", "worktree", "lst"], empty);
  expect(git.err).toContain('unknown git worktree subcommand "lst"');
  const mcp = await capture(["mcp"], empty);
  expect(mcp.err).toContain("mcp needs a subcommand: login, logout, status");
});

it.each([["status"], ["logs"], ["sessions"], ["doctor"], ["hooks", "report"]])(
  "says the same thing about a missing pmcp.toml for %s",
  async (...argv) => {
    const result = await capture(argv, empty);
    expect(result.code).toBe(2);
    expect(result.err).toContain(NO_CONFIG);
  },
);
