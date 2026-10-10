import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export async function verifyMcp(runtime, cli, project, env) {
  const child = spawn(runtime, [cli, "--lexical", "--no-config"], {
    cwd: project,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let sequence = 0;
  let diagnostics = "";
  child.stderr.on("data", (chunk) => {
    diagnostics = (diagnostics + chunk.toString()).slice(-2048);
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    try {
      const response = JSON.parse(line);
      const request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id);
      clearTimeout(request.timeout);
      if (response.error)
        request.reject(new Error(JSON.stringify(response.error)));
      if (!response.error) request.resolve(response.result);
    } catch (error) {
      for (const request of pending.values()) request.reject(error);
    }
  });
  const fail = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    pending.clear();
  };
  child.once("error", fail);
  child.once("exit", (code) =>
    fail(new Error(`MCP exited ${code}: ${diagnostics}`)),
  );
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      sequence += 1;
      const id = sequence;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, 15_000);
      pending.set(id, { resolve, reject, timeout });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  try {
    const initialized = await call("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "pmcp-packed-verification", version: "1.0.0" },
    });
    assert.ok(initialized.serverInfo);
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    const listing = await call("tools/list", {});
    assert.ok(listing.tools.some((tool) => tool.name === "skill_find"));
    const result = await call("tools/call", {
      name: "skill_find",
      arguments: { intent: "TypeScript type checking" },
    });
    assert.notEqual(result.isError, true);
    assert.ok(result.content.length > 0);
    return {
      initialized: true,
      tools: listing.tools.length,
      find: true,
      bareStdioPreserved: true,
    };
  } finally {
    fail(new Error("MCP verification complete"));
    lines.close();
    child.stdin.end();
    child.kill("SIGTERM");
  }
}
