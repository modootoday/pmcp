import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { COMMANDS, dispatch } from "../src/commands/index.js";
import { Ui } from "../src/cli/ui.js";

interface Baseline {
  readonly top: string;
  readonly unknown: string;
  readonly commands: Readonly<Record<string, string>>;
}

const baseline: Baseline = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "fixtures/cli-help-0.17.4.json"),
    "utf8",
  ),
);
const COMPLETION_ROW =
  "  completion   Print a shell completion script for bash, zsh or fish\n";

const SESSION_ROWS = [
  "  sessions     Show and coordinate the live sessions of this workspace: pause, broadcast, sweep\n",
  "  logs         Read this project's pmcp JSONL logs, filtered by session, trace, component, level or time\n",
  "  git          Create and sync worktrees, deliver commits to the mainline, sync the main checkout\n",
  "  mcp          Manage the project's shared remote MCP authentication\n",
].join("");

function withCompletionRow(text: string): string {
  return text
    .replace(
      /( {2}serve .*\n)/u,
      "  status       Show enabled features, projection drift and live workspace state\n  init         Create a starting pmcp.toml using this checkout's git detection\n  hooks        List compiled policies or simulate a native hook without a runtime\n$1",
    )
    .replace(/( {2}doctor .*\n)/u, `$1${SESSION_ROWS}`)
    .replace(/( {2}marketplace .*\n)/u, `$1${COMPLETION_ROW}`);
}

// 0.18.0 removes the tmux view operations: their usage tail and the view-only options go, and
// --config loses its create-only remark. Nothing else changes.
const TUI_REMOVED = [
  "  --group-file <file>     Existing owned harness group\n",
  "  --view <file>           Private TUI view state\n",
  "  --columns <count>       Terminal columns (40–1000)\n",
  "  --rows <count>          Terminal rows (12–1000)\n",
  "  --index <count>         Worker dock index\n",
  "  --confirm-session <id>  Exact target ID for stop\n",
  "  --actor-file <file>     Optional private mailbox observer credential\n",
];

function withoutTuiViews(text: string): string {
  let out = text
    .replace(" | operation --view <file>\n", "\n")
    .replace(
      "Project pmcp.toml (or mailbox config for create)",
      "Project pmcp.toml",
    );
  for (const line of TUI_REMOVED) {
    expect(out).toContain(line);
    out = out.replace(line, "");
  }
  // Without --confirm-session the option column narrows by three characters.
  return out.replace(/^( {2}--\S+(?: <[^>]+>)?) {3}/gmu, "$1");
}

async function capture(argv: readonly string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const ui = new Ui({
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
  });
  const code = await dispatch(argv, { ui, env: {}, cwd: "/" });
  return { code, out: out.join(""), err: err.join("") };
}

it("prints every 0.17.4 command help byte for byte, tui without its views", async () => {
  for (const [name, pinned] of Object.entries(baseline.commands)) {
    const text = name === "tui" ? withoutTuiViews(pinned) : pinned;
    for (const flag of ["--help", "-h"]) {
      const result = await capture([name, flag]);
      expect(result).toEqual({ code: 0, out: "", err: text });
    }
    expect((await capture(["help", name])).err).toBe(text);
  }
});

it("prints the 0.17.4 top-level help with only the added verbs' rows", async () => {
  for (const argv of [["--help"], ["-h"], ["help"]]) {
    const result = await capture(argv);
    expect(result).toEqual({
      code: 0,
      out: "",
      err: withCompletionRow(baseline.top),
    });
  }
  expect(withCompletionRow(baseline.top)).not.toBe(baseline.top);
});

it("answers an unknown verb with exit 2 and the same help", async () => {
  const result = await capture(["nope"]);
  expect(result).toEqual({
    code: 2,
    out: "",
    err: withCompletionRow(baseline.unknown),
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
