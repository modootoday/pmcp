import {
  McpAuthError,
  request,
  responseObject,
  safeEndpoint,
} from "../_shared.js";
import type { OAuthClient, Session } from "../types.js";

export async function tokenRequest(
  oauth: OAuthClient,
  serverUrl: string,
  grant: Record<string, string>,
  previous?: Session,
): Promise<Session> {
  if (
    safeEndpoint(oauth.tokenEndpoint).origin !==
    safeEndpoint(oauth.issuer).origin
  )
    throw new McpAuthError("OAuth token endpoint does not match the issuer");
  const form = new URLSearchParams({
    ...grant,
    client_id: oauth.clientId,
    resource: serverUrl,
  });
  if (oauth.clientSecret) form.set("client_secret", oauth.clientSecret);
  const response = await request(oauth.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new McpAuthError(
      "MCP authentication failed or was revoked; run pmcp mcp login again",
    );
  }
  const body = await responseObject(response);
  if (
    typeof body.access_token !== "string" ||
    !body.access_token ||
    (body.token_type !== undefined &&
      String(body.token_type).toLowerCase() !== "bearer")
  )
    throw new McpAuthError(
      "OAuth response is missing a supported access token",
    );
  const lifetime =
    body.expires_in === undefined ? undefined : Number(body.expires_in);
  if (lifetime !== undefined && (!Number.isFinite(lifetime) || lifetime < 0))
    throw new McpAuthError("OAuth response has an invalid expiry");
  const scopes =
    typeof body.scope === "string"
      ? body.scope.split(/\s+/u).filter(Boolean)
      : (previous?.scopes ?? []);
  return {
    serverUrl,
    kind: "oauth",
    oauth,
    accessToken: body.access_token,
    refreshToken:
      typeof body.refresh_token === "string"
        ? body.refresh_token
        : previous?.refreshToken,
    expiresAt:
      lifetime === undefined ? undefined : Date.now() + lifetime * 1000,
    scopes,
  };
}

export async function revokeSession(session: Session): Promise<void> {
  const oauth = session.oauth;
  if (!oauth?.revocationEndpoint) return;
  if (
    safeEndpoint(oauth.revocationEndpoint).origin !==
    safeEndpoint(oauth.issuer).origin
  )
    throw new McpAuthError(
      "OAuth revocation endpoint does not match the issuer",
    );
  for (const token of [session.refreshToken, session.accessToken]) {
    if (!token) continue;
    const form = new URLSearchParams({ token, client_id: oauth.clientId });
    if (oauth.clientSecret) form.set("client_secret", oauth.clientSecret);
    const response = await request(oauth.revocationEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    await response.body?.cancel();
    if (!response.ok)
      throw new McpAuthError(
        "Remote OAuth revocation failed; local credentials were cleared",
      );
  }
}
