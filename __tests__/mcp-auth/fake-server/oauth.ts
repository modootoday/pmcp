import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { setTimeout } from "node:timers/promises";
import { body, send } from "./_shared.js";
import type { FakeState } from "./types.js";

export async function oauthRoute(
  req: IncomingMessage,
  res: ServerResponse,
  state: FakeState,
): Promise<boolean> {
  const url = new URL(req.url!, state.resource);
  const origin = url.origin;
  if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
    send(res, 200, {
      resource: state.resource,
      authorization_servers: [origin],
      scopes_supported: ["tools:read"],
    });
    return true;
  }
  if (url.pathname === "/.well-known/oauth-authorization-server") {
    send(res, 200, {
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      registration_endpoint: `${origin}/register`,
      revocation_endpoint: `${origin}/revoke`,
      code_challenge_methods_supported: state.pkce ? ["S256"] : [],
    });
    return true;
  }
  if (url.pathname === "/register") {
    send(res, 201, { client_id: "test-client" });
    return true;
  }
  if (url.pathname === "/authorize") {
    state.challenge = url.searchParams.get("code_challenge")!;
    const location = new URL(url.searchParams.get("redirect_uri")!);
    location.searchParams.set("code", "approved");
    location.searchParams.set("state", url.searchParams.get("state")!);
    res.writeHead(302, { Location: location.toString() }).end();
    return true;
  }
  if (url.pathname === "/token") {
    const form = new URLSearchParams(await body(req));
    if (form.get("resource") !== state.resource) {
      send(res, 400, { error: "invalid_target" });
      return true;
    }
    if (form.get("grant_type") === "authorization_code") {
      const challenge = createHash("sha256")
        .update(form.get("code_verifier") ?? "")
        .digest("base64url");
      if (form.get("code") !== "approved" || challenge !== state.challenge) {
        send(res, 400, { error: "invalid_grant" });
        return true;
      }
      state.issued++;
    } else {
      state.refreshes++;
      await setTimeout(75);
      if (state.revoked || form.get("refresh_token") !== state.refreshToken) {
        send(res, 400, { error: "invalid_grant", secret: state.accessToken });
        return true;
      }
    }
    state.accessToken = `fake-access-${state.issued}-${state.refreshes}`;
    state.refreshToken = `fake-refresh-${state.issued}-${state.refreshes}`;
    send(res, 200, {
      token_type: "Bearer",
      access_token: state.accessToken,
      refresh_token: state.refreshToken,
      expires_in: 120,
      scope: "tools:read",
    });
    return true;
  }
  if (url.pathname === "/revoke") {
    state.revoked = true;
    send(res, 200, {});
    return true;
  }
  return false;
}
