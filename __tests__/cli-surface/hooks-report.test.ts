import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { fixture } from "./helpers.js";

const config = (report = "") =>
  `[targets]\ntools = ["claude", "codex"]\n[sessions]\nstate_dir = ".state"\n${report}`;

// Guard log lines as the hook bundle writes them at debug level.
function line(
  policy: string,
  runtime: string,
  session: string,
  mode: string,
  raw: string,
  verdict: string | undefined,
  ms: number,
  ts = "2026-10-27T10:00:00.000Z",
) {
  return JSON.stringify({
    ts,
    level: "debug",
    component: "hooks.entry",
    runtime,
    event: "before_tool",
    session,
    policy,
    ...(verdict ? { verdict } : {}),
    duration_ms: ms,
    msg: "policy",
    data: { raw, mode, tool: "shell", native: "Bash" },
  });
}

function logs(root: string, lines: readonly string[]): void {
  const dir = join(root, ".state/logs");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "pmcp-20261027.jsonl"), `${lines.join("\n")}\n`);
}

const LINES = [
  line("shell.heredoc", "claude", "aaaa1111-s", "observe", "deny", "allow", 1),
  line("shell.heredoc", "claude", "aaaa1111-s", "observe", "allow", "allow", 3),
  line("shell.heredoc", "claude", "bbbb2222-s", "observe", "deny", "allow", 9),
  line("shell.heredoc", "codex", "cccc3333-s", "deny", "deny", "deny", 2),
  line("git.stage_all", "claude", "shadow-replay-1", "deny", "deny", "deny", 4),
  JSON.stringify({ component: "hooks.entry", msg: "hook done", session: "x" }),
];

it("counts raw verdicts, sessions and durations per guard and runtime", async (t) => {
  const { root, run } = fixture(
    t,
    config('[hooks.report]\nexclude_sessions = ["^shadow-"]\n'),
  );
  logs(root, LINES);
  const result = await run("hooks", "report", "--json");
  expect(result.code).toBe(0);
  const report = JSON.parse(result.out);
  expect(report).toMatchObject({ lines: 4, sessions: 3, excluded: 1 });
  expect(report.guards).toEqual([
    {
      policy: "shell.heredoc",
      runtime: "claude",
      calls: 3,
      raw: { deny: 2, allow: 1 },
      verdict: { allow: 3 },
      modes: ["observe"],
      sessions: 2,
      durationMs: { p50: 3, p95: 9, max: 9 },
    },
    {
      policy: "shell.heredoc",
      runtime: "codex",
      calls: 1,
      raw: { deny: 1 },
      verdict: { deny: 1 },
      modes: ["deny"],
      sessions: 1,
      durationMs: { p50: 2, p95: 2, max: 2 },
    },
  ]);
});

it("--switch-check lists what an observed guard would have refused", async (t) => {
  const { root, run } = fixture(t, config());
  logs(root, LINES);
  const result = await run(
    "hooks",
    "report",
    "--switch-check",
    "shell.heredoc",
    "--json",
  );
  expect(result.code).toBe(0);
  const found = JSON.parse(result.out).refused;
  expect(found.map((row: { session: string }) => row.session)).toEqual([
    "aaaa1111-s",
    "bbbb2222-s",
  ]);
  const text = await run("hooks", "report", "--switch-check", "shell.heredoc");
  expect(text.out + text.err).toContain(
    "shell.heredoc would have refused 2 call(s) it let through",
  );
});

it("--since leaves older lines out, and a bad exclude regex is refused", async (t) => {
  const { root, run } = fixture(t, config());
  logs(root, [
    line(
      "shell.heredoc",
      "claude",
      "old0old0-s",
      "deny",
      "deny",
      "deny",
      1,
      "2026-10-20T00:00:00.000Z",
    ),
    line(
      "shell.heredoc",
      "claude",
      "new0new0-s",
      "deny",
      "deny",
      "deny",
      1,
      "2026-10-27T10:00:00.000Z",
    ),
  ]);
  const result = await run(
    "hooks",
    "report",
    "--since",
    "2026-10-26T00:00:00Z",
    "--json",
  );
  expect(JSON.parse(result.out).sessions).toBe(1);
  writeFileSync(
    join(root, "pmcp.toml"),
    config('[hooks.report]\nexclude_sessions = ["("]\n'),
  );
  const bad = await run("hooks", "report", "--json");
  expect(bad.code).not.toBe(0);
  expect(bad.err).toContain("exclude_sessions has an invalid regex");
});
