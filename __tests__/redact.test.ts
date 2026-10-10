import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { readSkillFile } from "../src/files/read.js";
import { REDACTED, redactMcpConfig } from "../src/files/redact.js";
import { createSkillTools } from "../src/server.js";

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const CONFIG = {
  mcpServers: {
    docs: {
      command: "npx",
      args: ["docs-mcp"],
      env: { DOCS_TOKEN: "sk-live-123", REGION: "eu" },
    },
    remote: {
      type: "http",
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer abc" },
    },
  },
};

function marketplace(): string {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-redact-"));
  write(
    join(dir, ".claude-plugin", "marketplace.json"),
    JSON.stringify({
      name: "shop",
      metadata: { tier: "open" },
      plugins: [{ name: "kit", source: "./plugins/kit" }],
    }),
  );
  const kit = join(dir, "plugins", "kit");
  write(
    join(kit, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "kit", hooks: "./hooks/hooks.json" }),
  );
  write(
    join(kit, "hooks", "hooks.json"),
    JSON.stringify({ description: "Guards.", hooks: {} }),
  );
  write(join(kit, ".mcp.json"), JSON.stringify(CONFIG));
  return dir;
}

const tools = () =>
  createSkillTools({ roots: [], marketplaces: [marketplace()] });

const leaks = (text: string) =>
  ["sk-live-123", "Bearer abc", "eu"].filter((secret) =>
    text.includes(`"${secret}"`),
  );

describe("redactMcpConfig", () => {
  it("replaces every env and headers value and keeps the rest of the config", () => {
    const out = JSON.parse(redactMcpConfig(JSON.stringify(CONFIG)));
    expect(out.mcpServers.docs).toEqual({
      command: "npx",
      args: ["docs-mcp"],
      env: { DOCS_TOKEN: REDACTED, REGION: REDACTED },
    });
    expect(out.mcpServers.remote.headers).toEqual({ Authorization: REDACTED });
    expect(out.mcpServers.remote.url).toBe("https://mcp.example.com/mcp");
  });

  it("serves nothing of a config it cannot parse", () => {
    const out = redactMcpConfig('{"mcpServers": {"x": {"env": {"K": "v"');
    expect(out).not.toContain('"v"');
    expect(JSON.parse(out)).toEqual({
      redacted: REDACTED,
      reason: "not valid JSON",
    });
  });
});

describe("an MCP config reached through the tools", () => {
  it("call returns the config without its secrets", () => {
    const body = tools().call("shop/kit/mcp/docs")!.body;
    expect(leaks(body)).toEqual([]);
    expect(JSON.parse(body).mcpServers.docs.command).toBe("npx");
  });

  it("read of the MCP entry and of the hook entry's plugin both redact", () => {
    const t = tools();
    const own = t.read("shop/kit/mcp/docs");
    const viaHook = t.read("shop/kit/hooks", ".mcp.json");
    for (const result of [own, viaHook]) {
      expect(result.ok).toBe(true);
      if (result.ok) expect(leaks(result.text ?? "")).toEqual([]);
    }
  });

  it("the listed digest and size describe the bytes a client receives", () => {
    const t = tools();
    const listed = t
      .describe("shop/kit/hooks")!
      .files.find((f) => f.path === ".mcp.json")!;
    const served = t.read("shop/kit/hooks", ".mcp.json");
    expect(served.ok).toBe(true);
    if (!served.ok) return;
    const bytes = Buffer.from(served.text ?? "", "utf8");
    expect(listed.bytes).toBe(bytes.length);
    expect(listed.sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(served.sha256).toBe(listed.sha256);
  });

  it("leaves other files byte for byte", () => {
    const entry = tools().entry("shop/kit/hooks")!;
    const result = readSkillFile(entry, "hooks/hooks.json");
    expect(result.ok && JSON.parse(result.text ?? "")).toEqual({
      description: "Guards.",
      hooks: {},
    });
  });
});
