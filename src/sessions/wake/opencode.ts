import { opencodeUrl as urlOf } from "./opencode-url.js";
import type { Transport, WakeEnv, WakeResult } from "./types.js";

// opencode's own server (opencode.ai/docs/server): POST /session/:id/prompt_async answers 204 and
// runs the prompt. Loaded only to send a wake, so library entry points never reach fetch.

function headers(env: WakeEnv["env"]): Record<string, string> {
  const password = env["OPENCODE_SERVER_PASSWORD"];
  const base = { "content-type": "application/json" };
  if (!password) return base;
  const user = env["OPENCODE_SERVER_USERNAME"] ?? "opencode";
  const basic = Buffer.from(`${user}:${password}`).toString("base64");
  return { ...base, authorization: `Basic ${basic}` };
}

export const opencodeServer: Transport = {
  probe: (record) => (urlOf(record) ? "opencode-server" : null),
  async wake(record, text, context): Promise<WakeResult> {
    const base = { session: record.session, runtime: "opencode" };
    const url = urlOf(record);
    if (!url)
      return {
        ...base,
        outcome: "not-wakeable",
        detail: "no opencode server URL recorded for the session",
      };
    const endpoint = `${url}/session/${encodeURIComponent(record.session)}/prompt_async`;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: headers(context.env),
        body: JSON.stringify({ parts: [{ type: "text", text }] }),
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok)
        return {
          ...base,
          outcome: "woken",
          transport: "opencode-server",
          detail: `${endpoint} answered ${response.status}`,
        };
      return {
        ...base,
        outcome: "failed",
        transport: "opencode-server",
        detail: `${endpoint} answered ${response.status}`,
      };
    } catch (error) {
      // The server went away with its session; the mail waits for the next event as before.
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ...base,
        outcome: "not-wakeable",
        transport: "opencode-server",
        detail: `${endpoint} unreachable: ${reason}`,
      };
    }
  },
};
