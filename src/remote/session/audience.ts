import { DEFAULT_API_ORIGIN } from "../catalog.js";
import type { StoredSession } from "./types.js";

// A session saved before the resource was recorded was minted for the default API.
export function sessionAudience(session: StoredSession): string {
  return new URL(session.resource ?? DEFAULT_API_ORIGIN).origin;
}

export function audienceMismatch(
  session: StoredSession,
  apiOrigin: string,
): string | null {
  const audience = sessionAudience(session);
  const target = new URL(apiOrigin).origin;
  if (target === audience) return null;
  return `this sign-in is for ${audience}, not ${target}; sign in again with PMCP_OAUTH_RESOURCE=${target} before using that API`;
}
