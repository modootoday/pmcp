import { expect, it } from "vitest";
import { Ui } from "../src/cli/ui.js";
import { dispatch } from "../src/commands/index.js";
import { COMMANDS } from "../src/commands/registry.js";

async function capture(argv: readonly string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const ui = new Ui({
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
    env: {},
  });
  const code = await dispatch(argv, { ui, env: {}, cwd: "/" });
  return { code, out: out.join(""), err: err.join("") };
}

it("gives every command an example and every subcommand its own help", async () => {
  for (const command of COMMANDS) {
    expect(command.examples?.length ?? 0, command.name).toBeGreaterThan(0);
    const names = new Set((command.options ?? []).map((option) => option.name));
    for (const sub of command.subcommands ?? []) {
      for (const option of sub.options ?? [])
        expect(
          names.has(option),
          `${command.name} ${sub.name} --${option}`,
        ).toBe(true);
      expect(
        sub.examples?.length ?? 0,
        `${command.name} ${sub.name}`,
      ).toBeGreaterThan(0);
      const help = await capture([
        command.name,
        ...sub.name.split(" "),
        "--help",
      ]);
      expect(help.code).toBe(0);
      expect(help.out).toContain(`pmcp ${command.name} ${sub.name}\n`);
      expect(help.out).toContain("Examples");
    }
  }
});

it("lists the operations of harness and mailbox, host and mcp included", async () => {
  const harness = await capture(["harness", "--help"]);
  for (const name of [
    "layout",
    "host up",
    "mcp",
    "group create",
    "recovery abort-start",
  ])
    expect(harness.out).toContain(`    ${name} `);
  const mailbox = await capture(["mailbox", "--help"]);
  for (const name of ["init", "actor", "rotate", "export", "backup", "restore"])
    expect(mailbox.out).toContain(`    ${name} `);
});

it("shows only the options a subcommand takes", async () => {
  const test = await capture(["hooks", "test", "--help"]);
  expect(test.out).toContain("--fixtures");
  expect(test.out).not.toContain("--switch-check");
  const create = await capture(["git", "worktree", "create", "--help"]);
  expect(create.out).toContain("--base");
  expect(create.out).not.toContain("--no-push");
});

it("refuses help for a subcommand that does not exist", async () => {
  const result = await capture(["hooks", "lsit", "--help"]);
  expect(result.code).toBe(2);
  expect(result.err).toContain(
    'unknown hooks subcommand "lsit"; did you mean "list"?',
  );
  expect((await capture(["git", "worktree", "--help"])).code).toBe(0);
});
