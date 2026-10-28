import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "smol-toml";
import { describe, expect, it, type TestContext } from "vitest";

import { readConfig } from "../src/config.js";
import { project } from "../src/project/apply.js";
import { readSpec } from "../src/project/spec.js";

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function agent(root: string, name: string): void {
  write(
    join(root, `.agents/agents/${name}/agent.md`),
    `---\nname: ${name}\ndescription: The ${name} agent.\n---\n\nYou are ${name}.\n`,
  );
}

function repo(t: TestContext, toml: string, names: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), "pmcp-codex-agents-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  for (const name of names) agent(root, name);
  write(join(root, "pmcp.toml"), `[targets]\ntools = ["codex"]\n${toml}`);
  return root;
}

const spec = (root: string) => readSpec(readConfig(join(root, "pmcp.toml")));
const run = (root: string) => {
  const result = project(spec(root), { check: false });
  if (result.backup) rmSync(result.backup, { recursive: true, force: true });
  return result;
};
const agentToml = (root: string, file: string) =>
  parse(readFileSync(join(root, ".codex/agents", file), "utf8"));

describe("Codex agents", () => {
  it("name a hyphenated agent with underscores, file and name alike", (t) => {
    const root = repo(t, "", ["frontend-implementer"]);
    expect(run(root).code).toBe(0);
    expect(
      existsSync(join(root, ".codex/agents/frontend-implementer.toml")),
    ).toBe(false);
    expect(agentToml(root, "frontend_implementer.toml")).toEqual({
      name: "frontend_implementer",
      description: "The frontend-implementer agent.",
      developer_instructions: "You are frontend-implementer.",
    });
  });

  it("merge [agents.<name>.codex]: description, Codex keys and nested tables", (t) => {
    const root = repo(
      t,
      [
        "[agents.test-planner.codex]",
        'name = "browser_test_planner"',
        'description = "Plans browser tests."',
        'sandbox_mode = "read-only"',
        'model = "gpt-5"',
        "[agents.test-planner.codex.mcp_servers.browser]",
        'command = "npx"',
        'args = ["@playwright/mcp"]',
        'enabled_tools = ["browser_navigate", "browser_snapshot"]',
        "",
      ].join("\n"),
      ["test-planner"],
    );
    expect(run(root).code).toBe(0);
    expect(agentToml(root, "browser_test_planner.toml")).toEqual({
      name: "browser_test_planner",
      description: "Plans browser tests.",
      developer_instructions: "You are test-planner.",
      sandbox_mode: "read-only",
      model: "gpt-5",
      mcp_servers: {
        browser: {
          command: "npx",
          args: ["@playwright/mcp"],
          enabled_tools: ["browser_navigate", "browser_snapshot"],
        },
      },
    });
    expect(project(spec(root), { check: true }).code).toBe(0);
  });

  it("refuse developer_instructions or a bad name in the table, and a name two agents share", (t) => {
    const instructions = repo(
      t,
      '[agents.a.codex]\ndeveloper_instructions = "x"\n',
      ["a"],
    );
    expect(() => spec(instructions)).toThrow(
      "developer_instructions comes from the body of .agents/agents/a/agent.md",
    );
    const badName = repo(t, '[agents.a.codex]\nname = "a-b"\n', ["a"]);
    expect(() => spec(badName)).toThrow(
      "[agents.a.codex] name must be lowercase letters, digits and underscores",
    );
    const twins = repo(t, "", ["a-b", "a_b"]);
    expect(() => run(twins)).toThrow(
      "agents a-b and a_b are both a_b in Codex",
    );
  });

  it("remove the hyphenated file an earlier pmcp wrote", (t) => {
    const root = repo(t, "", ["frontend-implementer"]);
    // What 0.22.0 left: an owned .codex/agents/<name>.toml with the hyphen.
    const old = ".codex/agents/frontend-implementer.toml";
    const content = '# old\nname = "frontend-implementer"\n';
    write(join(root, old), content);
    const sha256 = createHash("sha256").update(content).digest("hex");
    write(
      join(root, "pmcp.lock"),
      `${JSON.stringify({ version: 1, outputs: [{ path: old, kind: "file", sha256 }] })}\n`,
    );
    expect(run(root).code).toBe(0);
    expect(existsSync(join(root, old))).toBe(false);
    expect(
      existsSync(join(root, ".codex/agents/frontend_implementer.toml")),
    ).toBe(true);
  });
});
