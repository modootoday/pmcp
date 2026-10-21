import type { Environment, Session } from "./types.js";
import { McpAuthError } from "./_shared.js";
import {
  clearCredentials,
  readCredentials,
  writeCredentials,
} from "./store/files.js";
import { withCredentialLock } from "./store/lock.js";
import { revokeSession, tokenRequest } from "./oauth/tokens.js";

import { boundSession } from "./status.js";
export { status } from "./status.js";

export async function accessToken(
  name: string,
  serverUrl: string,
  env: Environment = process.env,
  rejected?: string,
): Promise<string | undefined> {
  const current = boundSession(name, serverUrl, env);
  if (!current) return undefined;
  const usable = (session: Session) =>
    session.accessToken !== rejected &&
    (session.expiresAt === undefined ||
      session.expiresAt > Date.now() + 30_000);
  if (usable(current)) return current.accessToken;
  return withCredentialLock(name, env, async () => {
    const session = boundSession(name, serverUrl, env);
    if (!session)
      throw new McpAuthError(
        "MCP credentials were removed; run pmcp mcp login again",
      );
    if (usable(session)) return session.accessToken;
    if (!session.refreshToken || !session.oauth)
      throw new McpAuthError(
        "MCP authentication expired or was revoked; run pmcp mcp login again",
      );
    const refreshed = await tokenRequest(
      session.oauth,
      serverUrl,
      { grant_type: "refresh_token", refresh_token: session.refreshToken },
      session,
    );
    writeCredentials(
      name,
      { ...readCredentials(name, env), session: refreshed },
      env,
    );
    return refreshed.accessToken;
  });
}

export async function storeBearer(
  name: string,
  serverUrl: string,
  token: string,
  env: Environment = process.env,
): Promise<void> {
  if (!token || /[\r\n]/u.test(token))
    throw new McpAuthError(
      "The bearer token environment variable is missing or invalid",
    );
  await withCredentialLock(name, env, async () =>
    writeCredentials(
      name,
      {
        session: { serverUrl, kind: "bearer", accessToken: token, scopes: [] },
      },
      env,
    ),
  );
}

export async function logout(
  name: string,
  serverUrl: string,
  env: Environment = process.env,
): Promise<void> {
  await withCredentialLock(name, env, async () => {
    const session = boundSession(name, serverUrl, env);
    clearCredentials(name, env);
    if (session) await revokeSession(session);
  });
}
