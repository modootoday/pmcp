import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

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
    `[targets]\ntools = ["claude"]\n[budget]\nroot_bytes = 16000\n[hooks.guards.git.stage_all]\n[host.lease]\ndir = "${dir}"\nmax_load = 1000\nmax_io = 1000\n[sessions]\nstate_dir = ".state"\n[sessions.registry]\n`,
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
  ];
  const printed: Record<string, unknown> = {};
  for (const [name, args] of cases) {
    printed[name] = await data(...args);
    expect(validate(name, printed[name]), name).toEqual([]);
  }
  // The fixture's [budget] table makes status print its optional budget, so that is checked too.
  expect((printed["status"] as { budget?: unknown }).budget).toBeDefined();
});
