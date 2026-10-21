import type { IssuerMetadata } from "./types.js";
import type { StoredSession } from "./types.js";
import type { Fetcher } from "./types.js";
import { form } from "./_shared.js";
import { FORM_HEADERS } from "./_shared.js";
import { scopeOf } from "./_shared.js";
import { validateIssuerUrl } from "./discovery.js";
export async function refresh(
  metadata: IssuerMetadata,
  session: StoredSession,
  clientId: string,
  fetcher: Fetcher,
  now: () => number = Date.now,
): Promise<StoredSession | null> {
  if (typeof session.refreshToken !== "string" || session.refreshToken === "")
    return null;
  validateIssuerUrl(metadata.token_endpoint, session.issuer);
  let res;
  try {
    res = await fetcher(metadata.token_endpoint, {
      method: "POST",
      headers: FORM_HEADERS,
      body: form({
        grant_type: "refresh_token",
        refresh_token: session.refreshToken,
        client_id: clientId,
      }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const body = (await res.json()) as Record<string, unknown>;
  const token = body["access_token"];
  if (typeof token !== "string" || token === "") return null;
  const expiresIn = Number(body["expires_in"]);
  const rotated = body["refresh_token"];
  const scope = body["scope"];
  return {
    issuer: session.issuer,
    accessToken: token,
    refreshToken:
      typeof rotated === "string" && rotated !== ""
        ? rotated
        : session.refreshToken,
    ...(Number.isFinite(expiresIn)
      ? { expiresAt: now() + expiresIn * 1000 }
      : {}),
    ...scopeOf(scope, session.scope),
  };
}
export async function revoke(
  metadata: IssuerMetadata,
  session: StoredSession,
  clientId: string,
  fetcher: Fetcher,
): Promise<boolean> {
  if (!metadata.revocation_endpoint) return false;
  validateIssuerUrl(metadata.revocation_endpoint, session.issuer);
  let revoked = true;
  const tokens = [session.refreshToken, session.accessToken].filter(
    (token): token is string => typeof token === "string" && token !== "",
  );
  for (const token of tokens) {
    try {
      const res = await fetcher(metadata.revocation_endpoint, {
        method: "POST",
        headers: FORM_HEADERS,
        body: form({ token, client_id: clientId }),
      });
      if (!res.ok) revoked = false;
    } catch {
      revoked = false;
    }
  }
  return revoked;
}
