import { afterEach, describe, expect, it } from "vitest";
import {
  chmodSync,
  existsSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { beginLogin, completeLogin } from "../../src/mcp-auth/oauth/login.js";
import {
  credentialPath,
  readCredentials,
  writeCredentials,
} from "../../src/mcp-auth/store/files.js";
import { logout, status, storeBearer } from "../../src/mcp-auth/session.js";
import { callbackListener } from "../../src/mcp-auth/oauth/callback.js";
import { authorize, proxyProcess, workspace } from "./_shared.js";
import { fakeServer } from "./fake-server.js";

const servers: Awaited<ReturnType<typeof fakeServer>>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});
async function server() {
  const result = await fakeServer();
  servers.push(result);
  return result;
}

describe("shared MCP sessions", () => {
  it("completes PKCE login, stores private credentials and reports metadata only", async () => {
    const s = await server();
    const { env } = workspace();
    const file = await authorize(s.url, env);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(status("test", s.url, env)).toEqual({
      present: true,
      expiresAt: expect.any(String),
      scopes: ["tools:read"],
    });
    expect(Object.keys(status("test", s.url, env))).toEqual([
      "present",
      "expiresAt",
      "scopes",
    ]);
    expect(s.state.issued).toBe(1);
  });
  it("shares a login between two real proxy processes and preserves session headers", async () => {
    const s = await server();
    const { root, env } = workspace();
    await authorize(s.url, env);
    const results = await Promise.all([
      proxyProcess(root, s.url, env),
      proxyProcess(root, s.url, env),
    ]);
    for (const result of results) {
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("fake-result");
    }
    expect(s.state.issued).toBe(1);
    expect(s.state.refreshes).toBe(0);
    expect(s.state.calls).toBe(2);
    expect(s.state.sessions.size).toBe(2);
  });
  it("refreshes expired credentials exactly once across concurrent proxy processes", async () => {
    const s = await server();
    const { root, env } = workspace();
    await authorize(s.url, env);
    const record = readCredentials("test", env);
    record.session!.expiresAt = Date.now() - 1;
    writeCredentials("test", record, env);
    const results = await Promise.all([
      proxyProcess(root, s.url, env),
      proxyProcess(root, s.url, env),
    ]);
    expect(results.map((r) => r.code)).toEqual([0, 0]);
    expect(s.state.refreshes).toBe(1);
    expect(s.state.calls).toBe(2);
    expect(readCredentials("test", env).session!.expiresAt).toBeGreaterThan(
      Date.now(),
    );
  });
  it("surfaces revocation as an auth error without printing credentials or remote bodies", async () => {
    const s = await server();
    const { root, env } = workspace();
    await authorize(s.url, env);
    s.state.revoked = true;
    const result = await proxyProcess(root, s.url, env);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("authentication");
    expect(result.stdout + result.stderr).not.toContain("fake-access-");
    expect(result.stdout + result.stderr).not.toContain("fake-refresh-");
  });
  it("forwards SSE responses and notifications", async () => {
    const s = await server();
    s.state.sse = true;
    const { root, env } = workspace();
    await authorize(s.url, env);
    const result = await proxyProcess(root, s.url, env);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("notifications/message");
    expect(result.stdout).toContain("fake-result");
  });
  it("stores a bearer session from an environment value and clears it on logout", async () => {
    const s = await server();
    const { root, env } = workspace();
    s.state.accessToken = "fake-bearer";
    await storeBearer("test", s.url, s.state.accessToken, env);
    expect((await proxyProcess(root, s.url, env)).code).toBe(0);
    await logout("test", s.url, env);
    expect(status("test", s.url, env).present).toBe(false);
    expect(existsSync(credentialPath("test", env))).toBe(false);
  });
  it("revokes OAuth sessions on logout and removes the local session", async () => {
    const s = await server();
    const { env } = workspace();
    await authorize(s.url, env);
    await logout("test", s.url, env);
    expect(s.state.revoked).toBe(true);
    expect(status("test", s.url, env).present).toBe(false);
  });
  it("rejects callback state mismatches and accepts a pasted code with PKCE", async () => {
    const s = await server();
    const { env } = workspace();
    const pending = await beginLogin(
      "test",
      s.url,
      "http://127.0.0.1:8976/callback",
      env,
    );
    await fetch(pending.authorizationUrl, { redirect: "manual" });
    await expect(
      completeLogin(
        "test",
        s.url,
        "http://127.0.0.1:8976/callback?state=wrong&code=approved",
        env,
      ),
    ).rejects.toThrow("state");
    await completeLogin("test", s.url, "approved", env);
    expect(status("test", s.url, env).present).toBe(true);
  });
  it("completes through the loopback callback listener", async () => {
    const s = await server();
    const { env } = workspace();
    const callback = await callbackListener();
    try {
      const pending = await beginLogin(
        "test",
        s.url,
        callback.redirectUri,
        env,
      );
      const result = callback.wait(pending);
      await fetch(pending.authorizationUrl);
      await completeLogin("test", s.url, await result, env);
      expect(status("test", s.url, env).present).toBe(true);
    } finally {
      callback.close();
    }
  });
  it("refuses an issuer without PKCE S256", async () => {
    const s = await server();
    s.state.pkce = false;
    await expect(
      beginLogin("test", s.url, "http://127.0.0.1/callback", workspace().env),
    ).rejects.toThrow("PKCE");
  });
  it("binds tokens to the server URL", async () => {
    const s = await server();
    const { root, env } = workspace();
    await authorize(s.url, env);
    const result = await proxyProcess(root, s.url + "/different", env);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("another server URL");
    expect(s.state.calls).toBe(0);
  });
  it("rejects unsafe aliases, public credentials and symlinked credential files", async () => {
    const s = await server();
    const { root, env } = workspace();
    expect(() => credentialPath("../escape", env)).toThrow();
    await storeBearer("test", s.url, "fake-bearer", env);
    chmodSync(credentialPath("test", env), 0o644);
    expect(() => readCredentials("test", env)).toThrow("permissions");
    const destination = join(root, "target.json");
    writeFileSync(destination, "{}", { mode: 0o600 });
    symlinkSync(destination, credentialPath("linked", env));
    expect(() => readCredentials("linked", env)).toThrow(
      "private MCP credentials",
    );
    expect(readFileSync(destination, "utf8")).toBe("{}");
  });
  it("does not expose forbidden or failed remote response bodies", async () => {
    const s = await server();
    const { root, env } = workspace();
    await authorize(s.url, env);
    s.state.forbid = true;
    const denied = await proxyProcess(root, s.url, env);
    expect(denied.stdout).toContain("authentication");
    expect(denied.stdout + denied.stderr).not.toContain("fake-access-");
    s.state.forbid = false;
    s.state.fail = true;
    const failed = await proxyProcess(root, s.url, env);
    expect(failed.stdout).toContain("HTTP 500");
    expect(failed.stdout + failed.stderr).not.toContain("fake-access-");
  });
});
