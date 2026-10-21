import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { beginLogin, completeLogin } from "../../src/mcp-auth/oauth/login.js";
import { credentialPath } from "../../src/mcp-auth/store/files.js";
import type { Environment } from "../../src/mcp-auth/types.js";

export const packageRoot = resolve(import.meta.dirname, "../..");
export function workspace() {
  const root = mkdtempSync(join(tmpdir(), "pmcp-mcp-auth-"));
  return { root, env: { ...process.env, XDG_STATE_HOME: join(root, "state") } };
}

export async function authorize(url: string, env: Environment) {
  const pending = await beginLogin(
    "test",
    url,
    "http://127.0.0.1:8976/callback",
    env,
  );
  const response = await fetch(pending.authorizationUrl, {
    redirect: "manual",
  });
  await response.body?.cancel();
  await completeLogin("test", url, response.headers.get("location")!, env);
  return credentialPath("test", env);
}

export function proxyProcess(
  root: string,
  url: string,
  env: Environment,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  writeFileSync(
    join(root, "pmcp.toml"),
    `[targets]\ntools = ["claude", "codex"]\n[mcp.test]\nurl = ${JSON.stringify(url)}\nauth = "pmcp"\n`,
  );
  const child = spawn(
    process.execPath,
    [join(packageRoot, "dist/cli.js"), "project", "exec-mcp", "test"],
    { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const result = new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
  child.stdin.end(
    [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "echo", arguments: {} },
      },
    ]
      .map((v) => JSON.stringify(v) + "\n")
      .join(""),
  );
  return result;
}
