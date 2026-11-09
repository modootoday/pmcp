import { expect, it } from "vitest";
import { clampWidth, fitRecord, Ui, wrap } from "../src/cli/ui.js";
import { dispatch } from "../src/commands/index.js";
import { COMMANDS } from "../src/commands/registry.js";

function ui(env: Record<string, string>, tty = false, columns?: number) {
  const chunks: string[] = [];
  const stream = {
    write: (text: string) => chunks.push(text),
    isTTY: tty,
    ...(columns ? { columns } : {}),
  };
  return { chunks, ui: new Ui({ stdout: stream, stderr: stream, env }) };
}

async function helpLines(argv: readonly string[], env: Record<string, string>) {
  const { chunks, ui: view } = ui(env);
  await dispatch(argv, { ui: view, env, cwd: "/" });
  return chunks.join("").split("\n");
}

// The longest word of a line cannot be broken, so a line may only exceed the width by one.
function fits(lines: readonly string[], width: number): void {
  for (const line of lines) {
    if (line.length <= width) continue;
    expect(line.trim().split(" ").length, line).toBe(1);
  }
}

it("clamps the width to 40..120 and wraps on word boundaries", () => {
  expect(clampWidth(10)).toBe(40);
  expect(clampWidth(500)).toBe(120);
  expect(wrap("aa bb cc dd", 5, 0)).toEqual(["aa bb", "cc dd"]);
  expect(wrap("unbreakable-word x", 4, 0)).toEqual(["unbreakable-word", "x"]);
  expect(wrap("as is", undefined, 0)).toEqual(["as is"]);
});

it("reads COLUMNS first, then the terminal, then 80 for help and plain tables", () => {
  expect(ui({ COLUMNS: "60" }).ui.width("help")).toBe(60);
  expect(ui({ COLUMNS: "10" }).ui.width("table")).toBe(40);
  expect(ui({}, true, 100).ui.width("table")).toBe(100);
  expect(ui({}).ui.width("help")).toBe(80);
  expect(ui({}).ui.width("table")).toBeUndefined();
});

it("prints a table as one plain record per line off a terminal", () => {
  const { chunks, ui: view } = ui({});
  view.table([
    ["a", "first"],
    ["a-much-longer-name", "second"],
  ]);
  expect(chunks).toEqual(["  a  first\n", "  a-much-longer-name  second\n"]);
});

it("wraps a table on a terminal and stacks a name wider than its column", () => {
  const { chunks, ui: view } = ui({ NO_COLOR: "1" }, true, 40);
  view.table([
    ["short", "one two three four five six seven eight nine ten"],
    ["a-name-far-wider-than-forty-percent", "described below"],
  ]);
  const lines = chunks.join("").split("\n");
  fits(lines, 40);
  expect(lines).toContain("  a-name-far-wider-than-forty-percent");
  expect(lines).toContain("      described below");
});

it("fits status records to a terminal and keeps them whole off one", () => {
  const record =
    "waiter: pid 4242 since 12s cwd /a/very/long/workspace/path/that/goes/on label npm run build lane bulk";
  const tty = ui({ COLUMNS: "40" }, true);
  tty.ui.results.records([record, "short\tline"]);
  const lines = tty.chunks.join("").split("\n").filter(Boolean);
  for (const line of lines) expect(line.length).toBeLessThanOrEqual(40);
  expect(lines.length).toBeGreaterThan(3);
  expect(lines.at(-1)).toBe("short  line");
  expect(lines.some((line) => line.endsWith("…"))).toBe(true);
  const plain = ui({ COLUMNS: "40" }, false);
  plain.ui.results.records([record, "short\tline"]);
  expect(plain.chunks.join("")).toBe(`${record}\nshort\tline\n`);
});

it("hangs a wrapped record under its own indent", () => {
  expect(fitRecord("  path  by one two three", 12)).toEqual([
    "  path",
    "      by one",
    "      two",
    "      three",
  ]);
  expect(fitRecord("x".repeat(30), 10, "...")).toEqual(["xxx..."]);
});

it("keeps every help page within 80 columns off a terminal and within COLUMNS on one", async () => {
  for (const [env, width] of [
    [{}, 80],
    [{ COLUMNS: "40" }, 40],
    [{ COLUMNS: "200" }, 120],
  ] as const) {
    fits(await helpLines(["--help"], env), width);
    for (const command of COMMANDS)
      fits(await helpLines([command.name, "--help"], env), width);
  }
});
