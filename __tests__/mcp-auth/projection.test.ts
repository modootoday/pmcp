import { describe, expect, it } from "vitest";
import { readMcp } from "../../src/project/mcp-spec.js";
import { mcpOutputs } from "../../src/project/mcp.js";
import type { ProjectSpec } from "../../src/project/spec.js";

function spec(
  entry: Record<string, unknown>,
  tools: readonly string[] = ["claude", "codex"],
): ProjectSpec {
  return {
    root: "/tmp/mcp-projection-test",
    tools: new Set(tools) as ProjectSpec["tools"],
    skills: {},
    agents: {},
    packageRules: null,
    mcp: readMcp("test", { remote: entry }),
  };
}

describe("MCP authentication projection", () => {
  it("preserves native entries for omitted and explicit native authentication", () => {
    const entry = {
      url: "https://example.com/mcp",
      bearer_token_env_var: "TOKEN",
      header_env: { "X-Workspace": "WORKSPACE" },
      native: { codex: { startup_timeout_sec: 30 } },
    };
    expect(mcpOutputs(spec({ ...entry, auth: "native" }))).toEqual(
      mcpOutputs(spec(entry)),
    );
    const outputs = mcpOutputs(spec(entry));
    expect(JSON.stringify(outputs)).toContain("bearer_token_env_var");
    expect(JSON.stringify(outputs)).not.toContain("exec-mcp");
    expect(JSON.stringify(outputs)).toContain("https://example.com/mcp");
  });
  it("projects pmcp-owned HTTP authentication as stdio for both runtimes", () => {
    const outputs = mcpOutputs(
      spec({
        url: "https://example.com/mcp",
        auth: "pmcp",
        tools: ["read"],
        header_env: { "X-Workspace": "WORKSPACE" },
      }),
    );
    const serialized = JSON.stringify(outputs);
    expect(serialized).toContain("exec-mcp");
    expect(serialized).toContain("XDG_STATE_HOME");
    expect(serialized).toContain("WORKSPACE");
    expect(serialized).toContain("enabled_tools");
    expect(serialized).not.toContain("https://example.com/mcp");
    expect(outputs).toHaveLength(2);
  });
  it.each([
    ["gemini", ".gemini/settings.json"],
    ["antigravity", ".agents/plugins/pmcp-mcp/mcp_config.json"],
    ["grok", ".grok/config.toml"],
    ["opencode", "opencode.json"],
  ])(
    "projects pmcp-owned authentication through exec-mcp for %s",
    (tool, file) => {
      const outputs = mcpOutputs(
        spec({ url: "https://example.com/mcp", auth: "pmcp" }, [tool]),
      );
      const serialized = JSON.stringify(outputs);
      expect(serialized).toContain(file);
      expect(serialized).toContain("exec-mcp");
      expect(serialized).not.toContain("https://example.com/mcp");
    },
  );
  it.each([
    { url: "https://example.com/mcp", auth: "other" },
    { command: "node", auth: "pmcp" },
    { url: "http://example.com/mcp", auth: "pmcp" },
    {
      url: "https://example.com/mcp",
      auth: "pmcp",
      headers: { Authorization: "literal" },
    },
  ])("rejects unsupported authentication declarations", (entry) => {
    expect(() => readMcp("test", { remote: entry })).toThrow();
  });
  it("retains existing stdio and env_from launch behavior", () => {
    const before = spec({
      command: "node",
      args: ["server.mjs"],
      env_from: { KEY: { file: "secrets.json", pointer: "/key" } },
    });
    expect(JSON.stringify(mcpOutputs(before))).toContain("exec-mcp");
    expect(JSON.stringify(mcpOutputs(before))).not.toContain("XDG_STATE_HOME");
    expect(
      readMcp("test", { local: { command: "node", args: ["server.mjs"] } })
        .local,
    ).not.toHaveProperty("auth");
  });
});
