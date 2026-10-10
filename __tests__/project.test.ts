import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it, type TestContext } from "vitest";

import type { SkillEntry } from "../src/catalog.js";
import { readConfig } from "../src/config.js";
import { project } from "../src/project/apply.js";
import { doctor, type RunResult, type Runner } from "../src/project/doctor.js";
import { addEntry, removeAsset, withoutTables } from "../src/project/edit.js";
import { splitFrontmatter } from "../src/project/frontmatter.js";
import { launch } from "../src/project/mcp.js";
import { deriveName, ProjectError } from "../src/project/package-rules.js";
import { readSpec, type ProjectSpec } from "../src/project/spec.js";

function fixtureGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_COMMON_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_IMPLICIT_WORK_TREE",
    "GIT_SHALLOW_FILE",
    "GIT_GRAFT_FILE",
    "GIT_PREFIX",
    "GIT_INTERNAL_SUPER_PREFIX",
  ])
    delete env[key];
  return env;
}

beforeEach((t) => {
  const original = { ...process.env };
  const clean = fixtureGitEnv();
  const removed = Object.keys(original).filter((key) => !(key in clean));
  for (const key of removed) delete process.env[key];
  t.onTestFinished(() => {
    for (const key of removed) process.env[key] = original[key];
  });
});

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const BASE = `[targets]
tools = ["claude", "codex", "gemini", "grok", "antigravity"]

[skills.plan]
invocation = "user"

[agents.reviewer.claude]
tools = "Read, Grep"
model = "sonnet"
`;

function repo(t: TestContext, extra = ""): string {
  const root = mkdtempSync(join(tmpdir(), "pmcp-project-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  write(
    join(root, ".agents/skills/plan/SKILL.md"),
    "---\nname: plan\ndescription: Plan.\n---\n\nBody.\n",
  );
  write(
    join(root, ".agents/skills/router/SKILL.md"),
    "---\nname: router\ndescription: Route.\n---\n\nBody.\n",
  );
  write(
    join(root, ".agents/agents/reviewer/agent.md"),
    "---\nname: reviewer\ndescription: |\n  Reviews diffs.\n  Two lines.\n---\n\nYou review.\n",
  );
  write(
    join(root, ".claude/settings.json"),
    `${JSON.stringify({ permissions: { deny: [] } }, null, 2)}\n`,
  );
  write(join(root, "pmcp.toml"), `${BASE}${extra}`);
  return root;
}

function git(root: string): void {
  execFileSync("git", ["init", "-q"], { cwd: root, env: fixtureGitEnv() });
  execFileSync("git", ["add", "-A"], { cwd: root, env: fixtureGitEnv() });
}

const spec = (root: string): ProjectSpec =>
  readSpec(readConfig(join(root, "pmcp.toml")));
const run = (root: string) => project(spec(root), { check: false });
const check = (root: string) => project(spec(root), { check: true });
const json = (path: string) =>
  JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;

describe("pmcp project", () => {
  it("links skills for Claude and Grok and keeps a user-started skill out of the model's list", (t) => {
    const root = repo(t);
    expect(run(root).code).toBe(0);
    expect(readlinkSync(join(root, ".claude/skills/plan"))).toBe(
      "../../.agents/skills/plan",
    );
    expect(lstatSync(join(root, ".grok/skills/router")).isSymbolicLink()).toBe(
      true,
    );
    expect(existsSync(join(root, ".gemini/skills"))).toBe(false);
    const settings = json(join(root, ".claude/settings.json"));
    expect(settings["skillOverrides"]).toEqual({ plan: "user-invocable-only" });
    expect(settings["permissions"]).toEqual({ deny: [] });
    expect(
      readFileSync(
        join(root, ".agents/skills/plan/agents/openai.yaml"),
        "utf8",
      ),
    ).toContain("allow_implicit_invocation: false");
    expect(
      existsSync(join(root, ".agents/skills/router/agents/openai.yaml")),
    ).toBe(false);
  });

  it("merges Claude-only agent fields into Claude's copy and keeps them out of Gemini's", (t) => {
    const root = repo(t);
    run(root);
    const claude = splitFrontmatter(
      readFileSync(join(root, ".claude/agents/reviewer.md"), "utf8"),
    ).meta;
    expect(claude).toEqual({
      name: "reviewer",
      description: "Reviews diffs.\nTwo lines.\n",
      tools: "Read, Grep",
      model: "sonnet",
    });
    const gemini = splitFrontmatter(
      readFileSync(join(root, ".gemini/agents/reviewer.md"), "utf8"),
    ).meta;
    expect(gemini).toEqual({
      name: "reviewer",
      description: "Reviews diffs.\nTwo lines.\n",
    });
    expect(
      readFileSync(join(root, ".codex/agents/reviewer.toml"), "utf8"),
    ).toContain('name = "reviewer"');
  });

  it("projects a glob rule one level below .claude/rules with paths", (t) => {
    const root = repo(t);
    write(
      join(root, ".agents/rules/pkg.md"),
      '---\ntrigger: glob\nglobs:\n  - "src/**"\n---\n\nRead the SoT.\n',
    );
    run(root);
    const { meta, body } = splitFrontmatter(
      readFileSync(join(root, ".claude/rules/pmcp/pkg.md"), "utf8"),
    );
    expect(meta).toEqual({ paths: ["src/**"] });
    expect(body).toContain("Read the SoT.");
  });

  it("passes --check after a run and reports a hand edit, a stray and a removed source", (t) => {
    const root = repo(t);
    run(root);
    expect(check(root).code).toBe(0);
    write(join(root, ".claude/agents/reviewer.md"), "edited\n");
    expect(check(root).problems).toContain("drift: .claude/agents/reviewer.md");
    run(root);
    write(join(root, ".claude/agents/stray.md"), "---\nname: stray\n---\n");
    expect(check(root).problems).toContain(
      "undeclared: .claude/agents/stray.md",
    );
  });

  it("prunes what a removed source produced, settings key included", (t) => {
    const root = repo(t);
    run(root);
    write(join(root, "pmcp.toml"), '[targets]\ntools = ["claude", "codex"]\n');
    run(root);
    expect(
      json(join(root, ".claude/settings.json"))["skillOverrides"],
    ).toBeUndefined();
    expect(
      existsSync(join(root, ".agents/skills/plan/agents/openai.yaml")),
    ).toBe(false);
    expect(existsSync(join(root, ".grok/skills/plan"))).toBe(false);
    expect(check(root).code).toBe(0);
  });

  it("refuses a file it did not write but takes over a predecessor's copies", (t) => {
    const root = repo(t);
    write(join(root, ".claude/agents/reviewer.md"), "hand written\n");
    expect(run(root).code).toBe(3);
    write(
      join(root, ".claude/agents/reviewer.md"),
      "<!-- AUTO-GENERATED by scripts/agent/project.mjs -->\n",
    );
    expect(run(root).code).toBe(0);
  });

  it("flags a top-level .claude/rules file when Grok is a target, since Grok loads it unscoped", (t) => {
    const root = repo(t);
    run(root);
    write(join(root, ".claude/rules/loose.md"), "Always.\n");
    expect(check(root).problems).toContain(
      "undeclared: .claude/rules/loose.md",
    );
  });
});

describe("package rule links", () => {
  const RULES =
    '\n[rules.packages]\nfile = ".agent/rules/PACKAGE.RULE.md"\nstrip = ["web", "lib"]\n';
  const rule = (glob: string) => `---\npaths:\n  - "${glob}"\n---\n\n# Rules\n`;

  it("derives names without the strip prefix, packages segments or repeated tokens", () => {
    expect(deriveName("web/shop/ui/frontend", ["web", "lib"])).toBe(
      "shop-ui-frontend",
    );
    expect(deriveName("lib/kit/packages/kit-runtime", ["web", "lib"])).toBe(
      "kit-runtime",
    );
  });

  it("moves top-level links one level down under their established names", (t) => {
    const root = repo(t, RULES);
    write(
      join(root, "web/shop/ui/frontend/.agent/rules/PACKAGE.RULE.md"),
      rule("web/shop/ui/frontend/**/*"),
    );
    write(
      join(root, "web/shop/ui/frontend/.agent/rules/PACKAGE.md"),
      "# Long\n",
    );
    write(join(root, "web/shop/ui/frontend/src/a.ts"), "export {};\n");
    write(join(root, "lib/x/.agent/rules/PACKAGE.RULE.md"), rule("lib/x/**"));
    write(join(root, "lib/x/src/a.ts"), "export {};\n");
    mkdirSync(join(root, ".claude/rules"), { recursive: true });
    symlinkSync(
      "../../web/shop/ui/frontend/.agent/rules/PACKAGE.md",
      join(root, ".claude/rules/legacy-name.md"),
    );
    git(root);

    expect(run(root).code).toBe(0);
    expect(readlinkSync(join(root, ".claude/rules/pkg/legacy-name.md"))).toBe(
      "../../../web/shop/ui/frontend/.agent/rules/PACKAGE.RULE.md",
    );
    expect(existsSync(join(root, ".claude/rules/pkg/x.md"))).toBe(true);
    expect(existsSync(join(root, ".claude/rules/legacy-name.md"))).toBe(false);
    expect(check(root).code).toBe(0);
    // The lock keeps the adopted name once the legacy link is gone.
    expect(run(root).code).toBe(0);
    expect(existsSync(join(root, ".claude/rules/pkg/legacy-name.md"))).toBe(
      true,
    );
  });

  it("reports a paths glob that reaches no tracked file", (t) => {
    const root = repo(t, RULES);
    write(
      join(root, "lib/x/.agent/rules/PACKAGE.RULE.md"),
      rule("lib/gone/**"),
    );
    git(root);
    run(root);
    expect(check(root).problems).toContain(
      "dead glob: .claude/rules/pkg/x.md: lib/gone/**",
    );
  });

  it("refuses two packages that derive the same name", (t) => {
    const root = repo(t, RULES);
    write(join(root, "web/x/.agent/rules/PACKAGE.RULE.md"), rule("web/x/**"));
    write(join(root, "lib/x/.agent/rules/PACKAGE.RULE.md"), rule("lib/x/**"));
    git(root);
    expect(() => run(root)).toThrow(ProjectError);
  });
});

describe("mcp servers", () => {
  const MCP = `
[mcp.skills]
command = "node"
args = ["\${PROJECT_ROOT}/node_modules/@modootoday/pmcp/dist/cli.js", "serve"]
tools = ["skill_find"]
`;

  it("writes a server into each tool's file without disturbing what else is there", (t) => {
    const root = repo(t, MCP);
    write(
      join(root, ".gemini/settings.json"),
      '{"context":{"fileName":["AGENTS.md"]}}\n',
    );
    write(
      join(root, ".codex/config.toml"),
      '# hand\n[sandbox_workspace_write]\nwritable_roots = ["x"]\n',
    );
    run(root);
    expect(
      json(join(root, ".mcp.json"))["mcpServers"]["skills"]["command"],
    ).toBe("sh");
    const gemini = json(join(root, ".gemini/settings.json"));
    expect(gemini["context"]).toEqual({ fileName: ["AGENTS.md"] });
    expect(gemini["mcpServers"]["skills"]["includeTools"]).toEqual([
      "skill_find",
    ]);
    expect(
      json(join(root, ".agents/plugins/pmcp-mcp/mcp_config.json"))[
        "mcpServers"
      ]["skills"],
    ).toBeDefined();
    const codex = readFileSync(join(root, ".codex/config.toml"), "utf8");
    expect(
      codex.startsWith(
        '# hand\n[sandbox_workspace_write]\nwritable_roots = ["x"]\n',
      ),
    ).toBe(true);
    expect(codex).toContain("[mcp_servers.skills]");
    expect(readFileSync(join(root, ".grok/config.toml"), "utf8")).toContain(
      "[mcp_servers.skills]",
    );
    expect(check(root).code).toBe(0);
  });

  it("removes the block and keys when the server goes", (t) => {
    const root = repo(t, MCP);
    write(join(root, ".codex/config.toml"), "# hand\n");
    run(root);
    write(join(root, "pmcp.toml"), BASE);
    run(root);
    expect(readFileSync(join(root, ".codex/config.toml"), "utf8")).toBe(
      "# hand\n",
    );
    expect(json(join(root, ".mcp.json"))["mcpServers"]).toBeUndefined();
    expect(check(root).code).toBe(0);
  });

  it("finds the project root at spawn time from any directory below it", (t) => {
    const root = repo(t);
    mkdirSync(join(root, "deep/er"), { recursive: true });
    const spawn = launch({
      command: "echo",
      args: ["${PROJECT_ROOT}/x", "it's"],
      env: {},
    });
    expect(spawn.command).toBe("sh");
    const out = execFileSync("sh", [...spawn.args], {
      cwd: join(root, "deep/er"),
      encoding: "utf8",
    });
    expect(out.trim()).toBe(
      `${execFileSync("realpath", [root], { encoding: "utf8" }).trim()}/x it's`,
    );
  });

  it("leaves a spec without the root variable as given", () => {
    expect(launch({ command: "npx", args: ["-y", "x"], env: {} })).toEqual({
      command: "npx",
      args: ["-y", "x"],
      env: {},
    });
  });
});

describe("add and remove", () => {
  it("adds a catalog agent with tool fields moved to pmcp.toml, then removes it", (t) => {
    const root = repo(t);
    const source = join(root, "catalog/agents/linter.md");
    write(
      source,
      "---\nname: linter\ndescription: Lints.\ntools: Read\n---\n\nYou lint.\n",
    );
    const entry: SkillEntry = {
      name: "m/p/agents/linter",
      package: "m/p",
      slug: "agents/linter",
      description: "Lints.",
      path: source,
      kind: "agent",
      root: source,
    };
    addEntry(root, entry);
    expect(
      splitFrontmatter(
        readFileSync(join(root, ".agents/agents/linter/agent.md"), "utf8"),
      ).meta,
    ).toEqual({
      name: "linter",
      description: "Lints.",
    });
    expect(readFileSync(join(root, "pmcp.toml"), "utf8")).toContain(
      '[agents.linter.claude]\ntools = "Read"',
    );
    removeAsset(root, "linter");
    expect(existsSync(join(root, ".agents/agents/linter"))).toBe(false);
    expect(readFileSync(join(root, "pmcp.toml"), "utf8")).not.toContain(
      "linter",
    );
  });

  it("drops only the named tables", () => {
    const toml =
      '[skills.plan]\ninvocation = "user"\n\n[skills.plant]\ninvocation = "user"\n\n[agents.plan.claude]\ntools = "Read"\n';
    expect(withoutTables(toml, "plan")).toBe(
      '[skills.plant]\ninvocation = "user"\n',
    );
  });
});

describe("pmcp doctor", () => {
  const answer = (stdout: string, status = 0): RunResult => ({
    missing: false,
    status,
    stdout,
  });

  function runner(answers: Record<string, RunResult>): Runner {
    return (command, args) =>
      answers[`${command} ${args.join(" ")}`] ?? {
        missing: true,
        status: null,
        stdout: "",
      };
  }

  it("fails when Grok loads a .claude/rules file, skips a tool that is not installed", (t) => {
    const root = repo(t);
    run(root);
    const findings = doctor(spec(root), {
      home: root,
      run: runner({
        "grok inspect --json": answer(
          JSON.stringify({
            projectTrusted: true,
            skills: [{ name: "plan" }, { name: "router" }],
            projectInstructions: [{ path: `${root}/.claude/rules/a.md` }],
            mcpServers: [],
          }),
        ),
        "gemini skills list": answer("plan [Enabled]\nrouter [Enabled]\n"),
      }),
    });
    const by = (tool: string, check: string) =>
      findings.find((f) => f.tool === tool && f.check === check)?.status;
    expect(by("project", "outputs match sources")).toBe("ok");
    expect(by("grok", "no .claude/rules loaded")).toBe("fail");
    expect(by("grok", "project skills listed")).toBe("ok");
    expect(by("gemini", "project skills listed")).toBe("ok");
    expect(by("codex", "project trusted")).toBe("fail");
    expect(by("antigravity", "agents carry no tool lists")).toBe("ok");
  });

  it("names a skill Gemini does not list and an agent Antigravity would drop", (t) => {
    const root = repo(t);
    write(
      join(root, ".agents/agents/tooled/agent.md"),
      "---\nname: tooled\ndescription: T.\ntools: Read\n---\n\nX\n",
    );
    run(root);
    const findings = doctor(spec(root), {
      home: root,
      run: runner({ "gemini skills list": answer("plan [Enabled]\n") }),
      only: new Set(["gemini", "antigravity"]),
    });
    expect(findings.find((f) => f.tool === "gemini")?.detail).toBe(
      "missing: router",
    );
    expect(findings.find((f) => f.tool === "antigravity")?.status).toBe("fail");
  });
});
