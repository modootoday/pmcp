import type { SessionRecord } from "../types.js";

// The server URL the generated opencode plugin recorded for the session. Kept apart from the
// transport so status and doctor can say a session is wakeable without loading a network client.
export function opencodeUrl(record: SessionRecord): string | null {
  const url = record["wakeUrl"];
  return typeof url === "string" && /^https?:\/\//u.test(url)
    ? url.replace(/\/$/u, "")
    : null;
}
