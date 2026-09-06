/**
 * The device authorization grant, against whatever the issuer advertises.
 *
 * Nothing here is invented: the endpoints, grants and scopes all come from
 * `/.well-known/oauth-authorization-server`. A CLI that hardcodes a token URL
 * keeps working right up until the day it silently does not.
 *
 * No callback server. A loopback redirect fails over SSH, inside a container
 * and on a machine with no browser, which is where this tool tends to run.
 */
import {
  closeSync,
  fchmodSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

/**
 * A credential belongs to the person, not to the checkout. Kept out of the
 * project tree so it cannot be committed, copied into an image, or read by a
 * build that had no business seeing it. XDG when the environment sets it.
 */
export function globalDir(
  home = homedir(),
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const xdg = env["XDG_CONFIG_HOME"];
  return xdg !== undefined && xdg !== ""
    ? join(xdg, "pmcp")
    : join(home, ".pmcp");
}

export interface IssuerMetadata {
  readonly token_endpoint: string;
  readonly device_authorization_endpoint: string;
  readonly revocation_endpoint?: string;
  readonly grant_types_supported?: readonly string[];
  readonly scopes_supported?: readonly string[];
}

export interface DeviceStart {
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete?: string;
  readonly deviceCode: string;
  readonly intervalMs: number;
  readonly expiresAt: number;
}

export interface StoredSession {
  readonly issuer: string;
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt?: number;
  readonly scope?: string;
}

export type Fetcher = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const form = (fields: Record<string, string>): string =>
  new URLSearchParams(fields).toString();

const FORM_HEADERS = { "content-type": "application/x-www-form-urlencoded" };

function validateIssuerUrl(value: string, issuer: string): void {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.origin !== new URL(issuer).origin ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error("OAuth endpoint must stay on the issuer origin");
  }
}

export async function discover(
  issuer: string,
  fetcher: Fetcher,
): Promise<IssuerMetadata> {
  const base = issuer.replace(/\/+$/, "");
  const source = new URL(base);
  if (
    source.protocol !== "https:" ||
    source.username ||
    source.password ||
    source.search ||
    source.hash
  ) {
    throw new Error("the issuer must be a plain HTTPS origin");
  }
  const res = await fetcher(`${base}/.well-known/oauth-authorization-server`);
  if (!res.ok)
    throw new Error(`issuer did not answer discovery (${res.status})`);
  const body = (await res.json()) as IssuerMetadata;
  if (!body.token_endpoint || !body.device_authorization_endpoint) {
    throw new Error("issuer advertises no device grant");
  }
  // The document says where to send the device code and the refresh token. An
  // endpoint on another origin would send both to whoever served the document.
  for (const endpoint of [
    body.token_endpoint,
    body.device_authorization_endpoint,
    body.revocation_endpoint,
  ]) {
    if (endpoint !== undefined) validateIssuerUrl(endpoint, base);
  }
  const grants = body.grant_types_supported ?? [];
  if (grants.length > 0 && !grants.includes(DEVICE_GRANT)) {
    throw new Error("issuer does not support the device grant");
  }
  return body;
}

export async function startDevice(
  metadata: IssuerMetadata,
  request: { clientId: string; resource: string; scope: string },
  fetcher: Fetcher,
  now: () => number = Date.now,
): Promise<DeviceStart> {
  const res = await fetcher(metadata.device_authorization_endpoint, {
    method: "POST",
    headers: FORM_HEADERS,
    body: form({
      client_id: request.clientId,
      resource: request.resource,
      scope: request.scope,
    }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      String(body["error"] ?? `device request failed (${res.status})`),
    );
  }
  const deviceCode = body["device_code"];
  const userCode = body["user_code"];
  const verificationUri = body["verification_uri"];
  if (
    typeof deviceCode !== "string" ||
    typeof userCode !== "string" ||
    typeof verificationUri !== "string"
  ) {
    throw new Error("device response is missing a field");
  }
  const interval = Number(body["interval"] ?? 5);
  const expires = Number(body["expires_in"] ?? 600);
  const complete = body["verification_uri_complete"];
  return {
    deviceCode,
    userCode,
    verificationUri,
    ...(typeof complete === "string"
      ? { verificationUriComplete: complete }
      : {}),
    intervalMs: (Number.isFinite(interval) ? interval : 5) * 1000,
    expiresAt: now() + (Number.isFinite(expires) ? expires : 600) * 1000,
  };
}

export interface PollOutcome {
  readonly kind: "granted" | "pending" | "slow_down" | "denied" | "expired";
  readonly session?: StoredSession;
}

export async function pollOnce(
  metadata: IssuerMetadata,
  request: { clientId: string; deviceCode: string; issuer: string },
  fetcher: Fetcher,
  now: () => number = Date.now,
): Promise<PollOutcome> {
  const res = await fetcher(metadata.token_endpoint, {
    method: "POST",
    headers: FORM_HEADERS,
    body: form({
      grant_type: DEVICE_GRANT,
      device_code: request.deviceCode,
      client_id: request.clientId,
    }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (res.ok) {
    const token = body["access_token"];
    if (typeof token !== "string")
      throw new Error("token response has no token");
    const expiresIn = Number(body["expires_in"]);
    const refresh = body["refresh_token"];
    const scope = body["scope"];
    return {
      kind: "granted",
      session: {
        issuer: request.issuer,
        accessToken: token,
        ...(typeof refresh === "string" ? { refreshToken: refresh } : {}),
        ...(Number.isFinite(expiresIn)
          ? { expiresAt: now() + expiresIn * 1000 }
          : {}),
        ...(typeof scope === "string" ? { scope } : {}),
      },
    };
  }
  switch (body["error"]) {
    case "authorization_pending":
      return { kind: "pending" };
    case "slow_down":
      return { kind: "slow_down" };
    case "expired_token":
      return { kind: "expired" };
    default:
      return { kind: "denied" };
  }
}

const sessionPath = (home?: string): string =>
  join(globalDir(home), "session.json");

/**
 * An expiring access token is renewed without a second device approval. A
 * failure here is not fatal: the caller falls back to asking for a new grant,
 * which is the thing this exists to avoid rather than a state it must repair.
 */
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
    // A server that rotates the refresh token invalidates the one we hold, so
    // keeping the old value would sign this machine out on its next use.
    refreshToken:
      typeof rotated === "string" && rotated !== ""
        ? rotated
        : session.refreshToken,
    ...(Number.isFinite(expiresIn)
      ? { expiresAt: now() + expiresIn * 1000 }
      : {}),
    ...(typeof scope === "string"
      ? { scope }
      : session.scope !== undefined
        ? { scope: session.scope }
        : {}),
  };
}

export function readSession(home?: string): StoredSession | null {
  try {
    return JSON.parse(readFileSync(sessionPath(home), "utf8")) as StoredSession;
  } catch {
    return null;
  }
}

export function writeSession(session: StoredSession, home?: string): void {
  const path = sessionPath(home);
  mkdirSync(globalDir(home), { recursive: true, mode: 0o700 });
  // A creation mode is ignored when the file already exists, so a session
  // written once at a looser mode would stay readable for every later write.
  // The descriptor is narrowed before the credential reaches it.
  const fd = openSync(path, "w", 0o600);
  try {
    fchmodSync(fd, 0o600);
    writeSync(fd, `${JSON.stringify(session, null, 2)}\n`);
  } finally {
    closeSync(fd);
  }
}

export function clearSession(home?: string): void {
  try {
    rmSync(sessionPath(home));
  } catch {
    // Already gone is the outcome logout asks for.
  }
}

export async function revoke(
  metadata: IssuerMetadata,
  session: StoredSession,
  clientId: string,
  fetcher: Fetcher,
): Promise<boolean> {
  if (!metadata.revocation_endpoint) return false;
  validateIssuerUrl(metadata.revocation_endpoint, session.issuer);
  // The refresh token outlives the access token, so revoking only the access
  // token leaves the machine able to mint a new one -- that is not a logout.
  // Refresh goes first: if the second call fails the longer-lived half is
  // already gone.
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
