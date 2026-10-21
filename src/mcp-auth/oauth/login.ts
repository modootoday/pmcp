import { createHash, randomBytes } from "node:crypto";
import { McpAuthError, request, responseObject } from "../_shared.js";
import { readCredentials, writeCredentials } from "../store/files.js";
import { withCredentialLock } from "../store/lock.js";
import type { Environment, PendingLogin } from "../types.js";
import { discoverOAuth } from "./discovery.js";
import { tokenRequest } from "./tokens.js";
import {
  activeLogins,
  consumeLogin,
  MAX_PENDING_LOGINS,
  PENDING_LOGIN_TTL_MS,
  retainLogin,
  selectLogin,
} from "./pending.js";

export async function beginLogin(
  name: string,
  serverUrl: string,
  redirectUri: string,
  env: Environment = process.env,
  clientId?: string,
): Promise<PendingLogin> {
  return withCredentialLock(name, env, async () => {
    const current = readCredentials(name, env);
    if (activeLogins(current).length >= MAX_PENDING_LOGINS)
      throw new McpAuthError(
        "Too many pending MCP logins; complete one or log out before starting another",
      );
    const { metadata, scopes } = await discoverOAuth(serverUrl);
    let clientSecret: string | undefined;
    if (!clientId) {
      if (!metadata.registration_endpoint)
        throw new McpAuthError(
          "OAuth requires a pre-registered client; pass --client-id",
        );
      const response = await request(metadata.registration_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "pmcp",
          redirect_uris: [redirectUri],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new McpAuthError("OAuth client registration failed");
      }
      const client = await responseObject(response);
      if (typeof client.client_id !== "string" || !client.client_id)
        throw new McpAuthError(
          "OAuth registration returned no client identifier",
        );
      clientId = client.client_id;
      if (typeof client.client_secret === "string")
        clientSecret = client.client_secret;
    }
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const authorization = new URL(metadata.authorization_endpoint);
    const params = {
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      resource: serverUrl,
    };
    for (const [key, value] of Object.entries(params))
      authorization.searchParams.set(key, value);
    if (scopes.length)
      authorization.searchParams.set("scope", scopes.join(" "));
    const pending: PendingLogin = {
      serverUrl,
      state,
      verifier,
      redirectUri,
      authorizationUrl: authorization.toString(),
      expiresAt: Date.now() + PENDING_LOGIN_TTL_MS,
      scopes,
      oauth: {
        issuer: metadata.issuer,
        tokenEndpoint: metadata.token_endpoint,
        revocationEndpoint: metadata.revocation_endpoint,
        clientId,
        clientSecret,
      },
    };
    writeCredentials(name, retainLogin(current, pending), env);
    return pending;
  });
}

export function authorizationCode(
  input: string,
  pending: PendingLogin,
): string {
  if (!input.startsWith("http://") && !input.startsWith("https://")) {
    if (!input.trim() || input.length > 8192)
      throw new McpAuthError("Invalid pasted OAuth code");
    return input.trim();
  }
  const callback = new URL(input);
  const redirect = new URL(pending.redirectUri);
  if (
    callback.origin !== redirect.origin ||
    callback.pathname !== redirect.pathname ||
    callback.searchParams.get("state") !== pending.state
  )
    throw new McpAuthError("OAuth callback state or redirect does not match");
  if (callback.searchParams.has("error"))
    throw new McpAuthError("OAuth authorization was denied");
  const issuer = callback.searchParams.get("iss");
  if (issuer && issuer !== pending.oauth.issuer)
    throw new McpAuthError("OAuth callback issuer does not match");
  const code = callback.searchParams.get("code");
  if (!code) throw new McpAuthError("OAuth callback has no authorization code");
  return code;
}

export async function completeLogin(
  name: string,
  serverUrl: string,
  input: string,
  env: Environment = process.env,
): Promise<void> {
  await withCredentialLock(name, env, async () => {
    const record = readCredentials(name, env);
    const callbackInput = input.trim();
    const pending = selectLogin(record, serverUrl, callbackInput);
    const code = authorizationCode(callbackInput, pending);
    const session = await tokenRequest(pending.oauth, serverUrl, {
      grant_type: "authorization_code",
      code,
      code_verifier: pending.verifier,
      redirect_uri: pending.redirectUri,
    });
    if (!session.scopes.length) session.scopes = pending.scopes;
    writeCredentials(name, { ...consumeLogin(record, pending), session }, env);
  });
}
