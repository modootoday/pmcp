import { McpAuthError } from "../_shared.js";
import type { CredentialRecord, PendingLogin } from "../types.js";

export const MAX_PENDING_LOGINS = 8;
export const PENDING_LOGIN_TTL_MS = 60 * 60_000;

export function activeLogins(record: CredentialRecord): PendingLogin[] {
  const logins = [...(record.pendingLogins ?? [])];
  if (record.pending) logins.push(record.pending);
  return [
    ...new Map(logins.map((login) => [login.state, login])).values(),
  ].filter((login) => login.expiresAt > Date.now());
}

export function retainLogin(
  record: CredentialRecord,
  pending: PendingLogin,
): CredentialRecord {
  const active = activeLogins(record);
  if (active.length >= MAX_PENDING_LOGINS)
    throw new McpAuthError(
      "Too many pending MCP logins; complete one or log out before starting another",
    );
  return { ...record, pending, pendingLogins: [...active, pending] };
}

export function selectLogin(
  record: CredentialRecord,
  serverUrl: string,
  input: string,
): PendingLogin {
  const active = activeLogins(record).filter(
    (login) => login.serverUrl === serverUrl,
  );
  if (!active.length)
    throw new McpAuthError(
      "No current OAuth login for this MCP server; start login again",
    );
  if (input.startsWith("http://") || input.startsWith("https://")) {
    const state = new URL(input).searchParams.get("state");
    const selected = active.find((login) => login.state === state);
    if (!selected)
      throw new McpAuthError(
        "OAuth callback state does not match a saved login",
      );
    return selected;
  }
  if (active.length > 1)
    throw new McpAuthError(
      "Multiple OAuth logins are pending; paste the full callback URL to select its saved verifier",
    );
  return active[0]!;
}

export function consumeLogin(
  record: CredentialRecord,
  pending: PendingLogin,
): CredentialRecord {
  const remaining = activeLogins(record).filter(
    (login) => login.state !== pending.state,
  );
  return { ...record, pending: remaining.at(-1), pendingLogins: remaining };
}
