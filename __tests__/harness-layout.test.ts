import { expect, it } from "vitest";
import { dispatch } from "../src/commands/index.js";
import { Ui } from "../src/cli/ui.js";
import { planLayout } from "../src/harness/terminal/layout.js";

it.each([
  [120, 40],
  [160, 48],
  [120, 32],
  [1000, 1000],
])(
  "fits A panes into %i by %i terminal cells including borders and status",
  (columns, rows) => {
    const layout = planLayout(columns, rows);
    expect(layout.mode).toBe("a");
    const [main, dock, coordination] = layout.panes;
    expect(main!.columns).toBeGreaterThanOrEqual(80);
    expect(dock!.x).toBe(main!.columns + 1);
    expect(dock!.x + dock!.columns).toBe(columns);
    expect(dock!.rows).toBe(main!.rows);
    expect(coordination!.y).toBe(main!.rows + 1);
    expect(coordination!.columns).toBe(columns);
    expect(coordination!.y + coordination!.rows + layout.statusRows).toBe(rows);
  },
);

it.each([
  [40, 12],
  [80, 24],
  [100, 30],
  [119, 40],
  [160, 31],
])(
  "preserves the full native pane in compact %i by %i terminals",
  (columns, rows) => {
    const layout = planLayout(columns, rows);
    expect(layout.mode).toBe("compact");
    expect(layout.panes).toEqual([
      { role: "main", x: 0, y: 0, columns, rows: rows - 1 },
    ]);
    expect(layout.workerView).toBe("separate-window");
  },
);

it.each([
  [39, 24],
  [80, 11],
  [120.5, 40],
  [120, NaN],
  [Infinity, 40],
  [1001, 40],
  [80, 1001],
])("refuses unusable or unbounded dimensions %s by %s", (columns, rows) => {
  expect(() => planLayout(columns, rows)).toThrow(RangeError);
});

function captureUi() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const ui = new Ui({
    color: false,
    stdout: { write: (text) => stdout.push(text) },
    stderr: { write: (text) => stderr.push(text) },
  });
  return { ui, stdout, stderr };
}

it("returns layout JSON without a project, runtime or tmux installation", async () => {
  const { ui, stdout, stderr } = captureUi();
  const code = await dispatch(
    ["harness", "layout", "--columns", "120", "--rows", "40"],
    {
      ui,
      env: { PATH: "", HOME: "/not-a-home" },
      cwd: "/not-a-project",
    },
  );
  expect(code).toBe(0);
  expect(stderr).toEqual([]);
  expect(JSON.parse(stdout.join(""))).toEqual(planLayout(120, 40));
});

it.each([
  { args: ["start"] },
  { args: ["layout", "--columns", "80", "--rows", "11"] },
  { args: ["layout", "--columns", "80"] },
  { args: ["layout", "--columns", "8e1", "--rows", "24"] },
  { args: ["layout", "--columns", "120", "--rows", "40", "--submit"] },
])(
  "rejects invalid or unimplemented harness invocation $args",
  async ({ args }) => {
    const { ui, stderr } = captureUi();
    expect(await dispatch(["harness", ...args], { ui })).toBe(2);
    expect(stderr.length).toBeGreaterThan(0);
  },
);
