import type { IssuerMetadata } from "./types.js";
import type { DeviceStart } from "./types.js";
import type { Fetcher } from "./types.js";
import type { PollOutcome } from "./types.js";
import { DEVICE_GRANT } from "./_shared.js";
import { form } from "./_shared.js";
import { FORM_HEADERS } from "./_shared.js";
import { refresh } from "./tokens.js";
export async function startDevice(
  metadata: IssuerMetadata,
  request: {
    clientId: string;
    resource: string;
    scope: string;
  },
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
export async function pollOnce(
  metadata: IssuerMetadata,
  request: {
    clientId: string;
    deviceCode: string;
    issuer: string;
  },
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
