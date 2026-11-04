import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { parseData } from "../src/cli/envelope.js";
import { Ui } from "../src/cli/ui.js";
import { dispatch } from "../src/commands/index.js";
import { schemaWords } from "../src/commands/dispatch.js";
import { COMMANDS } from "../src/commands/registry.js";
import { renderReceipt } from "../src/commands/tui/render.js";

const empty = mkdtempSync(join(tmpdir(), "pmcp-envelope-"));
afterAll(() => rmSync(empty, { recursive: true, force: true }));

async function capture(argv: readonly string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const ui = new Ui({
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
    env: {},
  });
  const code = await dispatch(argv, { ui, env: {}, cwd: empty });
  return { code, out: out.join(""), err: err.join("") };
}

function command(name: string) {
  return COMMANDS.find((entry) => entry.name === name)!;
}

it("wraps a result in one envelope line", async () => {
  const result = await capture(["models", "--json"]);
  expect(result.code).toBe(0);
  expect(result.out.trim().split("\n")).toHaveLength(1);
  const envelope = JSON.parse(result.out);
  expect(envelope).toMatchObject({
    schema: "pmcp.models.v1",
    ok: true,
    errors: [],
  });
  expect(Array.isArray(envelope.data)).toBe(true);
});

it("still prints an envelope when the command fails", async () => {
  const missing = await capture(["status", "--json"]);
  expect(missing.code).toBe(2);
  expect(JSON.parse(missing.out)).toMatchObject({
    schema: "pmcp.status.v1",
    ok: false,
    data: null,
    errors: [{ code: "usage" }],
  });
  const typo = await capture(["list", "--json", "--jsno"]);
  expect(JSON.parse(typo.out).errors[0].message).toContain(
    "unknown option --jsno",
  );
  expect(typo.err).toContain("unknown option --jsno");
});

it("names the schema by command and subcommand", () => {
  expect(schemaWords(command("hooks"), [])).toEqual(["hooks", "list"]);
  expect(schemaWords(command("hooks"), ["test"])).toEqual(["hooks", "test"]);
  expect(schemaWords(command("git"), ["worktree", "list"])).toEqual([
    "git",
    "worktree",
    "list",
  ]);
  expect(schemaWords(command("mcp"), ["status", "remote"])).toEqual([
    "mcp",
    "status",
  ]);
  expect(schemaWords(command("list"), [])).toEqual(["list"]);
});

it("reads one value, JSON lines as an array, and anything else as text", () => {
  expect(parseData("")).toBeNull();
  expect(parseData('{"a":1}\n')).toEqual({ a: 1 });
  expect(parseData('{"a":1}\n{"a":2}\n')).toEqual([{ a: 1 }, { a: 2 }]);
  expect(parseData("plain")).toBe("plain");
});

it("leaves the machine-protocol commands unwrapped", () => {
  expect(command("mailbox").protocol).toBe(true);
  expect(command("harness").protocol).toBe(true);
});

it("renders a tui receipt as lines for a person", () => {
  const out: string[] = [];
  const ui = new Ui({
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => out.push(text) },
    env: {},
  });
  renderReceipt(ui, {
    ok: false,
    error: "tmux_missing",
    checks: { node: true },
  });
  expect(out.join("")).toBe(
    "ok: false\nerror: tmux_missing\nchecks:\n  node: true\n",
  );
});
