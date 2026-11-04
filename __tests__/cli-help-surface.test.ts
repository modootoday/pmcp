import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { COMMANDS, dispatch } from "../src/commands/index.js";
import { Ui } from "../src/cli/ui.js";

// Help is pinned per command in fixtures/cli-help; vitest run -u rewrites them after an intended change.
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

function helpText(result: { out: string; err: string }): string {
  expect(result.err).toBe("");
  return result.out;
}

it("prints every command's help the same way for --help, -h and help <command>", async () => {
  for (const command of COMMANDS) {
    const pinned = await capture([command.name, "--help"]);
    expect(pinned.code).toBe(0);
    await expect(helpText(pinned)).toMatchFileSnapshot(
      `fixtures/cli-help/${command.name}.txt`,
    );
    expect(await capture([command.name, "-h"])).toEqual(pinned);
    expect(await capture(["help", command.name])).toEqual(pinned);
  }
});

it("prints the top-level help for --help, -h and help", async () => {
  const pinned = await capture(["--help"]);
  expect(pinned.code).toBe(0);
  await expect(helpText(pinned)).toMatchFileSnapshot(
    "fixtures/cli-help/top.txt",
  );
  for (const argv of [["-h"], ["help"]]) {
    expect(await capture(argv)).toEqual(pinned);
  }
});

it("answers an unknown verb with exit 2 and a pointer, not the whole help", async () => {
  const result = await capture(["nope"]);
  expect(result).toEqual({
    code: 2,
    out: "",
    err: 'x unknown command "nope"\nRun pmcp --help for the commands.\n',
  });
});

it("generates bash, zsh and fish completion from the registry", async () => {
  for (const shell of ["bash", "zsh", "fish"]) {
    const result = await capture(["completion", shell]);
    expect(result.code).toBe(0);
    for (const command of COMMANDS) {
      expect(result.out).toContain(command.name);
      for (const option of command.options ?? []) {
        expect(result.out).toContain(option.name);
      }
    }
  }
});

it("emits a bash completion script bash accepts", async () => {
  const script = (await capture(["completion", "bash"])).out;
  const parsed = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
  expect(parsed.status).toBe(0);
  expect(script).toContain("complete -F _pmcp pmcp");
});

it("refuses an unknown shell as a usage error", async () => {
  const result = await capture(["completion", "tcsh"]);
  expect(result.code).toBe(2);
  expect(result.out).toBe("");
  expect(result.err).toContain("choose one shell: bash, zsh, fish");
});
