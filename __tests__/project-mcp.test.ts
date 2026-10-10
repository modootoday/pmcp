import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import { describe, expect, it, type TestContext } from "vitest";

import { readConfig } from "../src/config.js";
import { project } from "../src/project/apply.js";
import { doctor } from "../src/project/doctor.js";
import { execMcp, mcpEnvironment } from "../src/project/mcp-env.js";
import { planMcpImport, writeMcpImport } from "../src/project/mcp-import.js";
import { launch, mcpOutputs } from "../src/project/mcp.js";
import { readSpec } from "../src/project/spec.js";

const TARGETS =
  '[targets]\ntools = ["claude", "codex", "gemini", "grok", "antigravity"]\n';

function fixture(t: TestContext, mcp = ""): { root: string; config: string } {
  const root = mkdtempSync(join(tmpdir(), "pmcp-mcp-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const config = join(root, "pmcp.toml");
  writeFileSync(config, TARGETS + mcp);
  return { root, config };
}

function json(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, "utf8"));
}

function cleanupBackup(t: TestContext, backup: string | undefined): void {
  if (backup) {
    t.onTestFinished(() => rmSync(backup, { recursive: true, force: true }));
  }
}

describe("project MCP transport and custody", () => {
  it.for<[string, string]>([
    ["skills: node fixture.js (stdio) - Connected\n", "ok"],
    [
      "skills: sh -c d=$PWD\nwhile test fixture\ndo\nexit\ndone\nexec node fixture.js (stdio) - Connected\n",
      "ok",
    ],
    [
      "skills: sh -c echo Connected\nexec node fixture.js (stdio) - Disconnected\nother: node other.js (stdio) - Connected\n",
      "fail",
    ],
    ["other: node other.js (stdio) - Connected\n", "fail"],
  ])(
    "reads Gemini server status across native command lines: %s",
    ([stdout, status], t) => {
      const { root, config } = fixture(
        t,
        '[mcp.skills]\ncommand = "node"\nargs = ["fixture.js"]\n',
      );
      const spec = readSpec(readConfig(config));
      const findings = doctor(spec, {
        home: root,
        only: new Set(["gemini"]),
        run: () => ({ missing: false, status: 0, stdout }),
      });
      expect(
        findings.find((finding) => finding.check === "mcp servers connected")
          ?.status,
      ).toBe(status);
    },
  );

  it("projects Streamable HTTP using Gemini httpUrl and preserves other native options", (t) => {
    const { root, config } = fixture(
      t,
      '[mcp.docs]\nurl = "https://example.com/mcp"\n',
    );
    mkdirSync(join(root, ".gemini"));
    writeFileSync(
      join(root, ".gemini/settings.json"),
      '{"context":{"fileName":"AGENTS.md"}}',
    );
    const result = project(readSpec(readConfig(config)), { check: false });
    cleanupBackup(t, result.backup);
    expect(result.code).toBe(0);
    expect(json(join(root, ".gemini/settings.json"))).toMatchObject({
      context: { fileName: "AGENTS.md" },
      mcpServers: { docs: { httpUrl: "https://example.com/mcp" } },
    });
    expect(json(join(root, ".mcp.json")).mcpServers.docs).toEqual({
      type: "http",
      url: "https://example.com/mcp",
    });
    expect(
      json(join(root, ".agents/plugins/pmcp-mcp/mcp_config.json")).mcpServers
        .docs,
    ).toEqual({ serverUrl: "https://example.com/mcp" });
    expect(
      parse(readFileSync(join(root, ".codex/config.toml"), "utf8")),
    ).toMatchObject({
      mcp_servers: { docs: { url: "https://example.com/mcp" } },
    });
    expect(project(readSpec(readConfig(config)), { check: true }).code).toBe(0);
  });

  it("projects header variable names without resolving credentials", (t) => {
    const { config } = fixture(
      t,
      '[mcp.api]\nurl = "https://example.com/mcp"\ntargets = ["claude", "codex", "gemini", "grok"]\nbearer_token_env_var = "TEST_MCP_TOKEN"\nheader_env = { "X-Workspace" = "TEST_MCP_WORKSPACE" }\n',
    );
    const outputs = mcpOutputs(readSpec(readConfig(config)));
    const codex = outputs.find(
      (entry) => entry.kind === "block" && entry.file === ".codex/config.toml",
    );
    expect(codex).toMatchObject({ kind: "block" });
    if (codex?.kind !== "block") {
      throw new Error("Missing Codex output");
    }
    expect(parse(codex.content)).toMatchObject({
      mcp_servers: {
        api: {
          bearer_token_env_var: "TEST_MCP_TOKEN",
          env_http_headers: { "X-Workspace": "TEST_MCP_WORKSPACE" },
        },
      },
    });
    const claude = outputs.find(
      (entry) => entry.kind === "json" && entry.file === ".mcp.json",
    );
    expect(claude).toMatchObject({
      value: {
        headers: {
          Authorization: "Bearer ${TEST_MCP_TOKEN}",
          "X-Workspace": "${TEST_MCP_WORKSPACE}",
        },
      },
    });
    expect(
      outputs.some(
        (entry) =>
          entry.kind === "json" &&
          entry.file === ".agents/plugins/pmcp-mcp/mcp_config.json",
      ),
    ).toBe(false);
  });

  it("refuses unsupported Antigravity headers before creating outputs", (t) => {
    const { root, config } = fixture(
      t,
      '[mcp.api]\nurl = "https://example.com/mcp"\nbearer_token_env_var = "TEST_MCP_TOKEN"\n',
    );
    expect(() =>
      project(readSpec(readConfig(config)), { check: false }),
    ).toThrow("not qualified");
    expect(existsSync(join(root, ".mcp.json"))).toBe(false);
  });

  for (const format of ["json", "toml"]) {
    it(`refuses an unmanaged ${format} alias conflict without writing other files`, (t) => {
      const { root, config } = fixture(
        t,
        '[mcp.docs]\nurl = "https://example.com/mcp"\n',
      );
      if (format === "json") {
        writeFileSync(
          join(root, ".mcp.json"),
          '{"mcpServers":{"docs":{"command":"personal-server"}}}',
        );
      } else {
        mkdirSync(join(root, ".codex"));
        writeFileSync(
          join(root, ".codex/config.toml"),
          '[mcp_servers.docs]\ncommand = "personal-server"\n',
        );
      }
      const result = project(readSpec(readConfig(config)), { check: false });
      expect(result.code).toBe(3);
      expect(existsSync(join(root, "pmcp.lock"))).toBe(false);
      expect(existsSync(join(root, ".gemini/settings.json"))).toBe(false);
    });
  }

  it("backs up original native files privately and records absent paths", (t) => {
    const { root, config } = fixture(
      t,
      '[mcp.docs]\nurl = "https://example.com/mcp"\n',
    );
    mkdirSync(join(root, ".grok"));
    const original = '# personal settings\nmodel = "grok"\n';
    writeFileSync(join(root, ".grok/config.toml"), original);
    const result = project(readSpec(readConfig(config)), { check: false });
    cleanupBackup(t, result.backup);
    expect(result.backup).toBeDefined();
    expect(
      readFileSync(join(result.backup!, "files/.grok/config.toml"), "utf8"),
    ).toBe(original);
    expect(statSync(result.backup!).mode & 0o077).toBe(0);
    expect(json(join(result.backup!, "receipt.json")).entries).toContainEqual({
      path: ".mcp.json",
      present: false,
    });
  });

  it("refuses malformed stale native JSON before writing replacement assets", (t) => {
    const { root, config } = fixture(t);
    writeFileSync(
      join(root, ".mcp.json"),
      '{"mcpServers": fixture-private-value}',
    );
    writeFileSync(
      join(root, "pmcp.lock"),
      JSON.stringify({
        outputs: [{ path: ".mcp.json#mcpServers.old", kind: "json" }],
      }),
    );
    writeFileSync(join(root, "AGENTS.md"), "Rules\n");
    writeFileSync(config, TARGETS + '\n[rules]\nroot = "AGENTS.md"\n');
    expect(() =>
      project(readSpec(readConfig(config)), { check: false }),
    ).toThrow("contents are redacted");
    expect(existsSync(join(root, "CLAUDE.md"))).toBe(false);
  });

  it("migrates only owned legacy Antigravity entries into a native project plugin", (t) => {
    const { root, config } = fixture(
      t,
      '[mcp.docs]\nurl = "https://example.com/mcp"\n',
    );
    mkdirSync(join(root, ".agents"));
    writeFileSync(
      join(root, ".agents/mcp_config.json"),
      JSON.stringify({
        mcpServers: {
          docs: { command: "old-generated" },
          personal: { command: "personal" },
        },
      }),
    );
    writeFileSync(
      join(root, "pmcp.lock"),
      JSON.stringify({
        outputs: [
          { path: ".agents/mcp_config.json#mcpServers.docs", kind: "json" },
        ],
      }),
    );
    const result = project(readSpec(readConfig(config)), { check: false });
    cleanupBackup(t, result.backup);
    expect(result.code).toBe(0);
    expect(json(join(root, ".agents/mcp_config.json"))).toEqual({
      mcpServers: { personal: { command: "personal" } },
    });
    expect(json(join(root, ".agents/plugins/pmcp-mcp/plugin.json"))).toEqual({
      name: "pmcp-mcp",
    });
    expect(
      json(join(root, ".agents/plugins/pmcp-mcp/mcp_config.json")),
    ).toMatchObject({
      mcpServers: { docs: { serverUrl: "https://example.com/mcp" } },
    });
    expect(
      json(join(result.backup!, "files/.agents/mcp_config.json")).mcpServers
        .docs.command,
    ).toBe("old-generated");
    expect(project(readSpec(readConfig(config)), { check: true }).code).toBe(0);
  });

  it("checks Antigravity's project plugin through native validation without claiming a connection", (t) => {
    const { root, config } = fixture(
      t,
      '[mcp.docs]\nurl = "https://example.com/mcp"\n',
    );
    const spec = readSpec(readConfig(config));
    const result = project(spec, { check: false });
    cleanupBackup(t, result.backup);
    const calls: string[][] = [];
    const findings = doctor(spec, {
      home: root,
      only: new Set(["antigravity"]),
      run: (command, args) => {
        calls.push([command, ...args]);
        return { missing: false, status: 0, stdout: "MCP configuration valid" };
      },
    });
    expect(calls).toEqual([
      ["agy", "plugin", "validate", join(root, ".agents/plugins/pmcp-mcp")],
    ]);
    expect(findings).toContainEqual({
      tool: "antigravity",
      check: "project MCP plugin valid",
      status: "ok",
    });
    expect(
      findings.some((finding) => finding.check.includes("connected")),
    ).toBe(false);
  });

  it("expands only declared variables and passes shell metacharacters as arguments", (t) => {
    const { root } = fixture(t);
    const launched = launch({
      command: process.execPath,
      args: [
        "-p",
        "JSON.stringify(process.argv.slice(1))",
        "${TEST_VALUE}",
        "$(touch forbidden)",
      ],
      env: {},
      envVars: ["TEST_VALUE"],
      cwd: root,
    });
    const output = execFileSync(launched.command, [...launched.args], {
      cwd: root,
      env: { ...process.env, TEST_VALUE: "space ' and $ value" },
      encoding: "utf8",
    });
    expect(JSON.parse(output)).toEqual([
      "space ' and $ value",
      "$(touch forbidden)",
    ]);
    expect(existsSync(join(root, "forbidden"))).toBe(false);
  });

  it("allows repeated argument values but rejects mixed transports and unknown fields", (t) => {
    const { config } = fixture(
      t,
      '[mcp.echo]\ncommand = "echo"\nargs = ["same", "same"]\n',
    );
    expect(readSpec(readConfig(config)).mcp.echo?.args).toEqual([
      "same",
      "same",
    ]);
    writeFileSync(
      config,
      TARGETS +
        '[mcp.echo]\ncommand = "echo"\nurl = "https://example.com/mcp"\n',
    );
    expect(() => readSpec(readConfig(config))).toThrow("exactly one");
    writeFileSync(
      config,
      TARGETS + '[mcp.echo]\ncommand = "echo"\nheders = {}\n',
    );
    expect(() => readSpec(readConfig(config))).toThrow("unknown field");
  });
});

describe("MCP import and environment references", () => {
  it("previews without writes and preserves credentials through a source pointer", (t) => {
    const { root, config } = fixture(t);
    const source = join(root, "native.json");
    writeFileSync(
      source,
      JSON.stringify({
        mcpServers: {
          api: { command: "server", env: { API_KEY: "fixture-private-value" } },
        },
      }),
    );
    const original = readFileSync(config, "utf8");
    const plan = planMcpImport(config, [`claude:${source}`]);
    expect(plan.entries).toMatchObject([{ alias: "api", status: "add" }]);
    expect(readFileSync(config, "utf8")).toBe(original);
    expect(JSON.stringify(plan.additions)).not.toContain(
      "fixture-private-value",
    );
    const backup = writeMcpImport(plan);
    cleanupBackup(t, backup);
    const spec = readSpec(readConfig(config));
    expect(mcpEnvironment(spec, "api")).toEqual({
      API_KEY: "fixture-private-value",
    });
    expect(JSON.stringify(mcpOutputs(spec))).not.toContain(
      "fixture-private-value",
    );
    writeFileSync(
      source,
      JSON.stringify({
        mcpServers: { api: { env: { API_KEY: "rotated-fixture-value" } } },
      }),
    );
    expect(mcpEnvironment(spec, "api")).toEqual({
      API_KEY: "rotated-fixture-value",
    });
  });

  it("reads TOML environment references and redacts missing-pointer failures", (t) => {
    const { root, config } = fixture(t);
    const source = join(root, "native.toml");
    writeFileSync(
      source,
      '[mcp_servers.api]\ncommand = "server"\nenv = { API_KEY = "fixture-private-value" }\n',
    );
    const backup = writeMcpImport(planMcpImport(config, [`codex:${source}`]));
    cleanupBackup(t, backup);
    const spec = readSpec(readConfig(config));
    expect(mcpEnvironment(spec, "api")).toEqual({
      API_KEY: "fixture-private-value",
    });
    writeFileSync(source, '[mcp_servers.api]\ncommand = "server"\n');
    expect(() => mcpEnvironment(spec, "api")).toThrow("contents are redacted");
  });

  it("preserves environment aliases as references to the declared source variable", (t) => {
    const { root, config } = fixture(t);
    const source = join(root, "native.json");
    writeFileSync(
      source,
      JSON.stringify({
        mcpServers: {
          api: {
            command: "server",
            env: { API_KEY: "${SHARED_KEY}", MODE: "${MODE}" },
          },
        },
      }),
    );
    const plan = planMcpImport(config, [`claude:${source}`]);
    expect(plan.additions.api).toMatchObject({
      env: { API_KEY: "${SHARED_KEY}" },
      env_vars: ["MODE"],
    });
    expect(plan.additions.api).not.toHaveProperty("env_from");
  });

  it("blocks conflicts, credential URLs and unmanaged authentication fields", (t) => {
    const { root, config } = fixture(t);
    const first = join(root, "first.json");
    const second = join(root, "second.json");
    writeFileSync(
      first,
      '{"mcpServers":{"same":{"command":"first"},"secret":{"url":"https://example.com/mcp?token=fixture-private-value"},"helper":{"command":"server","headersHelper":"private-helper"}}}',
    );
    writeFileSync(second, '{"mcpServers":{"same":{"command":"second"}}}');
    const plan = planMcpImport(config, [`claude:${first}`, `claude:${second}`]);
    expect(plan.entries.map((entry) => entry.status)).toEqual([
      "add",
      "blocked",
      "blocked",
      "conflict",
    ]);
    expect(JSON.stringify(plan.entries)).not.toContain("fixture-private-value");
    expect(() => writeMcpImport(plan)).toThrow("Resolve");
    expect(readFileSync(config, "utf8")).toBe(TARGETS);
  });

  it("refuses a stale import plan and names missing requested servers", (t) => {
    const { root, config } = fixture(t);
    const source = join(root, "native.json");
    writeFileSync(source, '{"mcpServers":{"api":{"command":"server"}}}');
    expect(
      planMcpImport(config, [`claude:${source}`], ["absent"]).entries,
    ).toMatchObject([{ alias: "absent", status: "blocked" }]);
    const plan = planMcpImport(config, [`claude:${source}`]);
    writeFileSync(config, TARGETS + "\n# concurrent edit\n");
    expect(() => writeMcpImport(plan)).toThrow("changed after planning");
  });

  it("preserves a value-free login flag and refuses credential-bearing query values", (t) => {
    const { root, config } = fixture(t);
    const source = join(root, "native.json");
    writeFileSync(
      source,
      JSON.stringify({
        mcpServers: {
          login: { url: "https://example.com/mcp?login" },
          credential: {
            url: "https://example.com/mcp?login=fixture-private-value",
          },
        },
      }),
    );
    const plan = planMcpImport(config, [`claude:${source}`]);
    expect(plan.entries.map((entry) => entry.status)).toEqual([
      "add",
      "blocked",
    ]);
    expect(plan.additions.login).toMatchObject({
      url: "https://example.com/mcp?login",
    });
    expect(JSON.stringify(plan.entries)).not.toContain("fixture-private-value");
  });

  it("refuses a native source changed after import planning", (t) => {
    const { root, config } = fixture(t);
    const source = join(root, "native.json");
    writeFileSync(source, '{"mcpServers":{"api":{"command":"first"}}}');
    const plan = planMcpImport(config, [`claude:${source}`]);
    writeFileSync(source, '{"mcpServers":{"api":{"command":"second"}}}');
    expect(() => writeMcpImport(plan)).toThrow("MCP source changed");
    expect(readFileSync(config, "utf8")).toBe(TARGETS);
  });

  it("executes a declared child with source credentials without sending them to stdout", async (t) => {
    const { root, config } = fixture(t);
    const source = join(root, "native.json");
    const child = join(root, "child.mjs");
    writeFileSync(
      child,
      'import { writeFileSync } from "node:fs";\nwriteFileSync("result.json", JSON.stringify({ authenticated: process.env.API_KEY === "fixture-private-value" }));\n',
    );
    writeFileSync(
      source,
      JSON.stringify({
        mcpServers: {
          api: {
            command: process.execPath,
            args: [child],
            env: { API_KEY: "fixture-private-value" },
          },
        },
      }),
    );
    const backup = writeMcpImport(planMcpImport(config, [`claude:${source}`]));
    cleanupBackup(t, backup);
    expect(
      await execMcp(readSpec(readConfig(config)), "api", {
        PATH: process.env.PATH,
      }),
    ).toBe(0);
    expect(json(join(root, "result.json"))).toEqual({ authenticated: true });
  });
});
