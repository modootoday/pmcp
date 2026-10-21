import {
  McpAuthError,
  request,
  responseObject,
  safeEndpoint,
} from "../_shared.js";
import type { OAuthMetadata } from "../types.js";

export async function discoverOAuth(
  serverUrl: string,
): Promise<{ metadata: OAuthMetadata; scopes: string[] }> {
  const resource = safeEndpoint(serverUrl);
  const challenge = await request(serverUrl, {
    headers: { Accept: "application/json, text/event-stream" },
  });
  const header = challenge.headers.get("www-authenticate") ?? "";
  await challenge.body?.cancel();
  const advertised = /resource_metadata="([^"]+)"/iu.exec(header)?.[1];
  const candidates = [
    advertised,
    `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`,
    `${resource.origin}/.well-known/oauth-protected-resource`,
  ].filter((v): v is string => Boolean(v));
  let issuer = resource.origin;
  let scopes = /(?:^|[,\s])scope="([^"]*)"/iu
    .exec(header)?.[1]
    ?.split(/\s+/u)
    .filter(Boolean);
  for (const url of [...new Set(candidates)]) {
    const res = await request(url);
    if (!res.ok) {
      await res.body?.cancel();
      continue;
    }
    const body = await responseObject(res);
    if (body.resource !== undefined && body.resource !== serverUrl)
      throw new McpAuthError(
        "OAuth resource metadata does not match the declared server",
      );
    const issuers = body.authorization_servers;
    if (!Array.isArray(issuers) || typeof issuers[0] !== "string") continue;
    issuer = issuers[0];
    if (!scopes && Array.isArray(body.scopes_supported))
      scopes = body.scopes_supported.filter(
        (v): v is string => typeof v === "string",
      );
    break;
  }
  const issuerUrl = safeEndpoint(issuer);
  const suffix = issuerUrl.pathname.replace(/\/$/u, "");
  const locations = [
    `${issuerUrl.origin}/.well-known/oauth-authorization-server${suffix}`,
    `${issuer.replace(/\/$/u, "")}/.well-known/openid-configuration`,
  ];
  for (const url of locations) {
    const res = await request(url);
    if (!res.ok) {
      await res.body?.cancel();
      continue;
    }
    const body = await responseObject(res);
    if (body.issuer !== issuer && body.issuer !== issuer.replace(/\/$/u, ""))
      throw new McpAuthError("OAuth issuer metadata mismatch");
    for (const key of ["authorization_endpoint", "token_endpoint"]) {
      if (typeof body[key] !== "string")
        throw new McpAuthError("OAuth metadata is missing required endpoints");
    }
    const metadata = body as unknown as OAuthMetadata;
    for (const endpoint of [
      metadata.authorization_endpoint,
      metadata.token_endpoint,
      metadata.registration_endpoint,
      metadata.revocation_endpoint,
    ]) {
      if (endpoint && safeEndpoint(endpoint).origin !== issuerUrl.origin)
        throw new McpAuthError(
          "OAuth endpoints must stay on the discovered issuer origin",
        );
    }
    if (!metadata.code_challenge_methods_supported?.includes("S256"))
      throw new McpAuthError("OAuth issuer must advertise PKCE S256");
    return { metadata, scopes: scopes ?? [] };
  }
  throw new McpAuthError(
    "Remote MCP server advertises no supported OAuth metadata",
  );
}
