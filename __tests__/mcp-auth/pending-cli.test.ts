import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { expect, it } from "vitest";
import { activeLogins } from "../../src/mcp-auth/oauth/pending.js";
import { readCredentials } from "../../src/mcp-auth/store/files.js";
import { status } from "../../src/mcp-auth/session.js";
import { packageRoot, workspace } from "./_shared.js";
import { fakeServer } from "./fake-server.js";

it("persists a waiting CLI login for completion by a later process", async () => {
  const server = await fakeServer();
  const { root, env } = workspace();
  writeFileSync(
    join(root, "pmcp.toml"),
    `[targets]\ntools = ["claude", "codex"]\n[mcp.test]\nurl = ${JSON.stringify(server.url)}\nauth = "pmcp"\n`,
  );
  const cli = join(packageRoot, "dist/cli.js");
  const waiting = spawn(process.execPath, [cli, "mcp", "login", "test"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const lines = createInterface({ input: waiting.stdout });
  try {
    const [authorizationUrl] = await once(lines, "line");
    expect(activeLogins(readCredentials("test", env))).toHaveLength(1);
    const closed = once(waiting, "close");
    waiting.kill("SIGTERM");
    await closed;
    const response = await fetch(authorizationUrl, { redirect: "manual" });
    await response.body?.cancel();
    const completion = spawn(
      process.execPath,
      [
        cli,
        "mcp",
        "login",
        "test",
        "--code",
        response.headers.get("location")!,
      ],
      { cwd: root, env, stdio: "ignore" },
    );
    const [code] = await once(completion, "close");
    expect(code).toBe(0);
    expect(status("test", server.url, env).present).toBe(true);
    expect(activeLogins(readCredentials("test", env))).toHaveLength(0);
  } finally {
    waiting.kill("SIGTERM");
    lines.close();
    await server.close();
  }
});
