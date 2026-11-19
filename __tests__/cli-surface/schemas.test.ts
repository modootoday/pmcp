import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

import { NATIVE_PLUGIN_RUNTIMES } from "../../src/marketplace/export.js";
import { TOOLS } from "../../src/project/tools.js";
import { RUNTIME_IDS } from "../../src/runtime/ids.js";
import { fixture } from "./helpers.js";
import { validator } from "./json-schema.js";

const document = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "../../docs/commands/schemas.json"),
    "utf8",
  ),
);
const validate = validator(document);

const waiter = {
  id: "a",
  pid: 1,
  label: "x",
  cwd: "/w",
  lane: "bulk",
  weight: 3,
  session: "s",
  position: 1,
  waited_s: 5,
  eta_s: null,
};

it("refuses what a published schema does not allow", () => {
  expect(
    validate("heavy-queue", {
      version: 1,
      schema: "pmcp.heavy.queue.v1",
      waiters: [waiter],
    }),
  ).toEqual([]);
  expect(
    validate("heavy-queue", {
      version: 1,
      schema: "pmcp.heavy.status.v1",
      waiters: [],
    }),
  ).toEqual(['heavy-queue.schema: expected "pmcp.heavy.queue.v1"']);
  expect(
    validate("heavy-queue", {
      version: 1,
      schema: "pmcp.heavy.queue.v1",
      waiters: [{ id: "a" }],
    }).length,
  ).toBeGreaterThan(5);
});

it("matches what each command with a published schema prints", async (t) => {
  const { root, run } = fixture(t, "");
  const dir = join(root, "lease");
  writeFileSync(
    join(root, "pmcp.toml"),
    `[targets]\ntools = ["claude"]\n[budget]\nroot_bytes = 16000\n[hooks.guards.git.stage_all]\n[host.lease]\ndir = "${dir}"\nmax_load = 1000\nmax_io = 1000\n[sessions]\nstate_dir = ".state"\n[sessions.registry]\n[sessions.mailbox]\n[[owners]]\npaths = ["src/**"]\nowner = "core"\nnote = "ask first"\n`,
  );
  // Two finished runs, so heavy stats prints a row rather than an empty list.
  mkdirSync(dir, { recursive: true });
  const run1 = {
    at: "2026-11-15T10:00:09.500Z",
    signature: "bun install",
    dir: ".",
    user_s: 1.2,
    sys_s: 0.3,
    max_rss_kb: 50000,
    read_bytes: 3e7,
    write_bytes: 0,
    source: "proc",
    wall_s: 8,
    lane: "bulk",
    weight: 3,
    start: "queue",
    outcome: "ran",
    exit: 0,
  };
  writeFileSync(
    join(dir, "usage.jsonl"),
    `${JSON.stringify(run1)}\n${JSON.stringify({ ...run1, wall_s: 22, exit: 1 })}\n`,
  );
  // One finished ticket carrying its run's usage, and one never started, whose result is null.
  const done = join(dir, "tickets", "1763200000-a1b2c3");
  const queued = join(dir, "tickets", "1763200001-d4e5f6");
  mkdirSync(done, { recursive: true });
  mkdirSync(queued, { recursive: true });
  for (const ticket of [done, queued])
    writeFileSync(join(ticket, "request.json"), '{"label":"install"}\n');
  writeFileSync(
    join(done, "result.json"),
    `${JSON.stringify({ version: 1, ticket: "1763200000-a1b2c3", ...run1 })}\n`,
  );
  const data = async (...args: string[]) => {
    const result = await run(...args, "--json");
    const envelope = JSON.parse(result.out);
    expect(validate("envelope", envelope), args.join(" ")).toEqual([]);
    return envelope.data;
  };
  const cases: [string, string[]][] = [
    ["status", ["status"]],
    ["hooks-list", ["hooks", "list"]],
    [
      "hooks-test",
      [
        "hooks",
        "test",
        "--runtime",
        "claude",
        "--event",
        "before_tool",
        "--command",
        "git add -A",
      ],
    ],
    ["logs", ["logs"]],
    ["sessions-status", ["sessions", "status"]],
    ["heavy-status", ["heavy", "status"]],
    ["heavy-queue", ["heavy", "queue"]],
    ["heavy-stats", ["heavy", "stats"]],
    ["hooks-report", ["hooks", "report"]],
    ["hooks-report", ["hooks", "report", "--switch-check", "git.stage_all"]],
    ["whoami", ["whoami"]],
    ["validate", ["validate", root]],
    ["models", ["models"]],
    ["marketplace-list", ["marketplace", "list"]],
    ["owners", ["owners", "src/a.ts", "docs/b.md"]],
    ["doctor", ["doctor", "--tool", "claude"]],
    ["heavy-result", ["heavy", "result", "1763200000-a1b2c3"]],
    ["heavy-result", ["heavy", "result", "1763200001-d4e5f6"]],
  ];
  await run("sessions", "send", "--session", "s1", "--to", "all", "hello");
  const printed: Record<string, unknown> = {};
  for (const [name, args] of cases) {
    printed[name] = await data(...args);
    expect(validate(name, printed[name]), name).toEqual([]);
  }
  // The fixture's [budget] table makes status print its optional budget, so that is checked too.
  expect((printed["status"] as { budget?: unknown }).budget).toBeDefined();
  expect(printed["heavy-stats"]).toHaveLength(1);
  const inbox = await data("sessions", "inbox", "--all", "--session", "s1");
  expect(validate("sessions-inbox", inbox)).toEqual([]);
  expect(inbox).toHaveLength(1);
  const owned = printed["owners"] as { paths: { owners: unknown[] }[] };
  expect(owned.paths[0]!.owners).toHaveLength(1);
  expect((printed["doctor"] as { features?: unknown }).features).toBeDefined();
  const plugins = (
    printed["marketplace-list"] as { plugins: { name: string }[] }
  ).plugins;
  expect(plugins.length).toBeGreaterThan(0);
  const exported = await data(
    "marketplace",
    "export",
    plugins[0]!.name,
    "--runtime",
    "agy",
    "--output",
    join(root, "exported"),
  );
  expect(validate("marketplace-export", exported)).toEqual([]);
});

it("keeps the doctor schema's runtimes equal to the ones doctor checks", () => {
  const doctor = document.schemas["doctor"].properties;
  expect(doctor.findings.items.properties.tool.enum).toEqual([
    ...TOOLS,
    "project",
  ]);
  expect(doctor.features.items.properties.cells.required).toEqual(RUNTIME_IDS);
});

it("keeps the export schema's runtimes equal to the ones export accepts", () => {
  expect(
    document.schemas["marketplace-export"].properties.runtime.enum,
  ).toEqual(NATIVE_PLUGIN_RUNTIMES);
});
