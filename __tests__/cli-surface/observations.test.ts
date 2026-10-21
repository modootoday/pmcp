import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createFilesStore } from "../../src/sessions/files-store.js";
import { status as authStatus } from "../../src/mcp-auth/status.js";
import { fixture } from "./helpers.js";

it("redacts credentials in both MCP status and the aggregate screen", async (t) => {
  const { root, run } = fixture(
    t,
    '[targets]\ntools = []\n[mcp.remote]\nurl = "https://example.invalid/mcp"\nauth = "pmcp"\n',
  );
  const dir = join(root, ".xdg/pmcp/credentials");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "remote.json"),
    JSON.stringify({
      session: {
        serverUrl: "https://example.invalid/mcp",
        kind: "bearer",
        accessToken: "never-print-this-token",
        scopes: ["read"],
      },
    }),
    { mode: 0o600 },
  );
  const individual = await run("mcp", "status", "remote", "--json");
  expect(individual.code).toBe(0);
  expect(JSON.parse(individual.out)).toEqual({
    version: 1,
    name: "remote",
    present: true,
    expiresAt: null,
    scopes: ["read"],
  });
  const aggregate = await run("status", "--json");
  expect(aggregate.code).toBe(0);
  expect(JSON.parse(aggregate.out).mcp[0].present).toBe(true);
  expect(individual.out + aggregate.out).not.toContain("never-print");
  expect(
    authStatus("absent", "https://example.invalid/mcp", {
      XDG_STATE_HOME: join(root, ".xdg"),
    }).present,
  ).toBe(false);
});

it("counts only errors from the last hour without pruning or acknowledging state", async (t) => {
  const { root, run } = fixture(
    t,
    '[targets]\ntools = []\n[sessions]\nstate_dir = ".state"\n[hooks]\nerror_log = ".state/errors.jsonl"\n',
  );
  mkdirSync(join(root, ".state"), { recursive: true });
  const now = Date.now();
  const line = (delta: number, level = "error") =>
    JSON.stringify({
      ts: new Date(now + delta).toISOString(),
      level,
      msg: "sample",
    });
  const contents = [
    line(-1000),
    line(-7_200_000),
    line(3_600_000),
    line(-1000, "info"),
    "null",
    "{}",
  ].join("\n");
  const path = join(root, ".state/errors.jsonl");
  writeFileSync(path, contents);
  const result = await run("status", "--json");
  expect(JSON.parse(result.out).errors).toHaveLength(1);
  expect(readFileSync(path, "utf8")).toBe(contents);
});

it("does not execute custom guard commands during a hook simulation", async (t) => {
  const { root, run } = fixture(
    t,
    '[targets]\ntools = ["claude"]\n[hooks]\n[[hooks.guards.custom]]\nname = "external"\ncommand = ["node", ".agents/guards/external.mjs"]\ntargets = ["claude"]\n',
  );
  mkdirSync(join(root, ".agents/guards"), { recursive: true });
  writeFileSync(
    join(root, ".agents/guards/external.mjs"),
    'import { writeFileSync } from "node:fs"; writeFileSync("executed", "yes");',
  );
  const result = await run(
    "hooks",
    "test",
    "--runtime",
    "claude",
    "--event",
    "before_tool",
    "--command",
    "printf safe",
    "--json",
  );
  expect(result.code).toBe(0);
  expect(JSON.parse(result.out).policies[0]).toMatchObject({
    policy: "custom.external",
    skipped: true,
  });
  expect(existsSync(join(root, "executed"))).toBe(false);
});

it("keeps a real pause and registry unchanged while evaluating synthetic lifecycle events", async (t) => {
  const { root, run } = fixture(
    t,
    '[targets]\ntools = ["claude"]\n[sessions]\nstate_dir = ".state"\n[sessions.registry]\n[sessions.pause]\n',
  );
  const store = createFilesStore(join(root, ".state"));
  store.pause.write({ by: "operator", reason: "real-state" });
  const before = readFileSync(join(root, ".state/pause.json"), "utf8");
  const result = await run(
    "hooks",
    "test",
    "--runtime",
    "claude",
    "--event",
    "session_start",
    "--json",
  );
  expect(result.code).toBe(0);
  expect(
    JSON.parse(result.out).decision.context?.join(" ") ?? "",
  ).not.toContain("real-state");
  expect(readFileSync(join(root, ".state/pause.json"), "utf8")).toBe(before);
  expect(store.registry.list()).toEqual([]);
});

it("keeps git worktree listing human output and adds a JSON snapshot", async (t) => {
  const { root, run } = fixture(t, "[git]\n[git.worktrees]\n");
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  const result = await run("git", "worktree", "list", "--json");
  expect(result.code).toBe(0);
  expect(JSON.parse(result.out).worktrees[0]).toMatchObject({
    path: root,
    main: true,
  });
  expect((await run("git", "worktree", "list")).out).toContain("(main)");
  expect((await run("git", "worktree", "sync", "--json")).code).toBe(2);
  expect((await run("sessions", "resume", "--json")).code).toBe(2);
  expect((await run("mcp", "logout", "remote", "--json")).code).toBe(2);
  expect((await run("logs", "--json", "--follow")).code).toBe(2);
});
