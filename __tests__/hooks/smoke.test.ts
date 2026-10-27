import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import { Ui } from "../../src/cli/ui.js";
import { dispatch } from "../../src/commands/index.js";
import { readConfig } from "../../src/config.js";
import {
  readFixtures,
  smoke,
  verdictOf,
  type Fixtures,
} from "../../src/hooks/inspection/smoke.js";
import { RUNTIME_IDS, type Decision } from "../../src/hooks/contract.js";
import { RUNTIMES } from "../../src/hooks/runtimes/index.js";
import { project } from "../../src/project/apply.js";
import { readSpec } from "../../src/project/spec.js";

const TOML = [
  '[targets]\ntools = ["claude", "codex"]\n',
  '[sessions]\nstate_dir = ".state"\n',
  "[hooks.guards.shell.heredoc]\n",
  '[hooks.guards.shell.in_place_edit]\nmode = "observe"\n',
  "[hooks.failure]\nretry = 1\n",
  '[hooks.test]\nfixtures = "smoke.json"\n',
].join("\n");

const HEREDOC = "cat > f.txt <<'EOF'\nx\nEOF";
const GOOD: Fixtures = {
  failure: { timeoutMs: 2000, retry: 1, pass: [] },
  cases: [
    {
      name: "heredoc",
      guard: "shell.heredoc",
      command: HEREDOC,
      expect: "deny",
    },
    { name: "plain", guard: "shell.heredoc", command: "ls", expect: "allow" },
  ],
};

function workspace(t: TestContext, toml = TOML): string {
  const root = mkdtempSync(join(tmpdir(), "pmcp-smoke-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "pmcp.toml"), toml);
  const result = project(readSpec(readConfig(join(root, "pmcp.toml"))), {
    check: false,
  });
  if (result.backup)
    t.onTestFinished(() =>
      rmSync(result.backup!, { recursive: true, force: true }),
    );
  expect(result.code).toBe(0);
  return root;
}

async function cli(root: string, ...args: string[]) {
  let out = "";
  const ui = new Ui({
    stdout: { write: (text) => void (out += text) },
    stderr: { write: (text) => void (out += text) },
  });
  const code = await dispatch(args, {
    cwd: root,
    env: { ...process.env, XDG_STATE_HOME: join(root, ".xdg") },
    ui,
  });
  return { code, out };
}

describe("hooks smoke through the projected hook entry", () => {
  it("runs every case on every wired runtime and finds nothing when all match", (t) => {
    const root = workspace(t);
    const result = smoke(root, GOOD, {
      ...process.env,
      GIT_DIR: join(root, "no-such-repository"),
    });
    expect(result).toEqual({
      runtimes: ["claude", "codex"],
      guards: ["shell.heredoc"],
      cases: 4,
      findings: [],
    });
  });

  it("reports a wrong decision, a coverage gap, [hooks.failure] drift and zero runs", (t) => {
    const root = workspace(t);
    const wrong = smoke(root, {
      failure: { timeoutMs: 2000, retry: 0, pass: [] },
      cases: [
        {
          name: "heredoc",
          guard: "shell.heredoc",
          command: HEREDOC,
          expect: "allow",
        },
      ],
    });
    expect(wrong.findings).toEqual(
      expect.arrayContaining([
        { where: "claude :: heredoc", message: "expected allow, got deny" },
        { where: "codex :: heredoc", message: "expected allow, got deny" },
        {
          where: "coverage",
          message: "shell.heredoc (claude): no refusing case",
        },
        expect.objectContaining({ where: "[hooks.failure]" }),
      ]),
    );
    const none = smoke(root, { cases: [] });
    expect(none.findings).toContainEqual({
      where: "cases",
      message: "0 cases executed",
    });
  });

  it("is pmcp hooks test --fixtures and pmcp project --check --smoke", async (t) => {
    const root = workspace(t);
    writeFileSync(join(root, "smoke.json"), JSON.stringify(GOOD));
    expect(
      (await cli(root, "hooks", "test", "--fixtures", "smoke.json")).code,
    ).toBe(0);
    const checked = await cli(root, "project", "--check", "--smoke");
    expect(checked.code).toBe(0);
    expect(checked.out).toContain("4 run(s) on claude, codex");
    writeFileSync(
      join(root, "smoke.json"),
      JSON.stringify({ ...GOOD, cases: GOOD.cases.slice(0, 1) }),
    );
    expect(
      (await cli(root, "hooks", "test", "--fixtures", "smoke.json")).code,
    ).toBe(1);
    expect((await cli(root, "project", "--check", "--smoke")).code).toBe(2);
  });
});

describe("fixtures and decisions", () => {
  it.each(RUNTIME_IDS)(
    "reads back what the %s adapter renders for a shell call",
    (id) => {
      const adapter = RUNTIMES[id];
      const native = adapter.nativeEvent("before_tool")!;
      const payload = adapter.synthetic({
        cwd: "/project",
        session: "abcd1234-session",
        event: native,
        command: "ls",
        tool: "shell",
      });
      const input = adapter.normalize(native, payload, "/project")!;
      const read = (decision: Decision) =>
        verdictOf(id, adapter.render(input, decision).stdout);
      expect(read({})).toBe("allow");
      expect(read({ context: ["note"] })).toBe("allow");
      expect(read({ verdict: "deny", reason: "no" })).toBe("deny");
      // Only Claude Code keeps an ask; the others refuse instead.
      expect(read({ verdict: "ask", reason: "sure?" })).toBe(
        id === "claude" ? "ask" : "deny",
      );
      expect(verdictOf(id, "not json")).toBe("unreadable");
    },
  );

  it("refuses a malformed case", () => {
    expect(() =>
      readFixtures(
        JSON.stringify({
          cases: [{ name: "a", guard: "g", command: "ls", expect: "maybe" }],
        }),
      ),
    ).toThrow("case 1 expect must be allow, deny or ask");
    expect(() =>
      readFixtures(
        JSON.stringify({
          cases: [
            {
              name: "a",
              guard: "g",
              command: "ls",
              expect: { nobody: "deny" },
            },
          ],
        }),
      ),
    ).toThrow("case 1 expect");
  });
});
