import { afterEach, expect, it } from "vitest";
import { beginLogin, completeLogin } from "../../src/mcp-auth/oauth/login.js";
import {
  activeLogins,
  MAX_PENDING_LOGINS,
  PENDING_LOGIN_TTL_MS,
  retainLogin,
  selectLogin,
} from "../../src/mcp-auth/oauth/pending.js";
import {
  readCredentials,
  writeCredentials,
} from "../../src/mcp-auth/store/files.js";
import { accessToken, status } from "../../src/mcp-auth/session.js";
import { authorize, workspace } from "./_shared.js";
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

it("completes either callback after starting a newer login without losing either verifier", async () => {
  const s = await server();
  const { env } = workspace();
  const first = await beginLogin(
    "test",
    s.url,
    "http://127.0.0.1:8976/callback",
    env,
  );
  const second = await beginLogin(
    "test",
    s.url,
    "http://127.0.0.1:8976/callback",
    env,
  );
  expect(activeLogins(readCredentials("test", env))).toHaveLength(2);
  expect(first.expiresAt).toBeGreaterThan(
    Date.now() + PENDING_LOGIN_TTL_MS - 5000,
  );
  const firstResponse = await fetch(first.authorizationUrl, {
    redirect: "manual",
  });
  await firstResponse.body?.cancel();
  await completeLogin(
    "test",
    s.url,
    firstResponse.headers.get("location")!,
    env,
  );
  expect(status("test", s.url, env).present).toBe(true);
  expect(
    activeLogins(readCredentials("test", env)).map((p) => p.state),
  ).toEqual([second.state]);
  const secondResponse = await fetch(second.authorizationUrl, {
    redirect: "manual",
  });
  await secondResponse.body?.cancel();
  await completeLogin(
    "test",
    s.url,
    secondResponse.headers.get("location")!,
    env,
  );
  expect(activeLogins(readCredentials("test", env))).toHaveLength(0);
  expect(s.state.issued).toBe(2);
});

it("requires callback state when multiple pasted-code logins are pending", async () => {
  const s = await server();
  const { env } = workspace();
  await beginLogin("test", s.url, "http://127.0.0.1:8976/callback", env);
  await beginLogin("test", s.url, "http://127.0.0.1:8976/callback", env);
  await expect(completeLogin("test", s.url, "approved", env)).rejects.toThrow(
    "full callback URL",
  );
  expect(s.state.issued).toBe(0);
  expect(activeLogins(readCredentials("test", env))).toHaveLength(2);
});

it("retains pending verifiers when a shared session is refreshed", async () => {
  const s = await server();
  const { env } = workspace();
  await authorize(s.url, env);
  const pending = await beginLogin(
    "test",
    s.url,
    "http://127.0.0.1:8976/callback",
    env,
  );
  const record = readCredentials("test", env);
  record.session!.expiresAt = Date.now() - 1;
  writeCredentials("test", record, env);
  await accessToken("test", s.url, env);
  expect(s.state.refreshes).toBe(1);
  expect(
    activeLogins(readCredentials("test", env)).map((p) => p.state),
  ).toEqual([pending.state]);
});

it("accepts a saved pending login from the original credential format", async () => {
  const s = await server();
  const { env } = workspace();
  const pending = await beginLogin(
    "test",
    s.url,
    "http://127.0.0.1:8976/callback",
    env,
  );
  writeCredentials("test", { pending }, env);
  const response = await fetch(pending.authorizationUrl, {
    redirect: "manual",
  });
  await response.body?.cancel();
  await completeLogin("test", s.url, response.headers.get("location")!, env);
  expect(status("test", s.url, env).present).toBe(true);
});

it("refuses to evict active logins at capacity and rejects expired callbacks", async () => {
  const s = await server();
  const { env } = workspace();
  const pending = await beginLogin(
    "test",
    s.url,
    "http://127.0.0.1:8976/callback",
    env,
  );
  const full = {
    pendingLogins: Array.from({ length: MAX_PENDING_LOGINS }, (_, i) => ({
      ...pending,
      state: `pending-${i}`,
    })),
  };
  expect(() => retainLogin(full, pending)).toThrow("Too many pending");
  expect(activeLogins(full)).toHaveLength(MAX_PENDING_LOGINS);
  expect(() =>
    selectLogin(
      { pending: { ...pending, expiresAt: Date.now() - 1 } },
      s.url,
      "approved",
    ),
  ).toThrow("No current OAuth login");
});
