import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";

import type { SessionRecord } from "../types.js";
import { claudeSocket, type ClaudeSessionFile } from "./claude-socket.js";
import type { Transport, WakeEnv, WakeResult } from "./types.js";

// Claude Code's documented cross-session inbox (code.claude.com/docs/en/cross-session-messaging).
const socketOf = (
  record: SessionRecord,
  context: WakeEnv,
): ClaudeSessionFile | null => claudeSocket(record.session, context.home);

// One NDJSON frame per connection, closed at once (the inbox drops a connection idle for 30 s).
// The auth line is the poster's own session token, so it is sent only to the poster's own socket.
export function frames(
  text: string,
  socket: string,
  env: WakeEnv["env"],
): string {
  const lines: string[] = [];
  const token = env["CLAUDE_CODE_MESSAGING_TOKEN"];
  if (token && env["CLAUDE_CODE_MESSAGING_SOCKET"] === socket)
    lines.push(JSON.stringify({ type: "auth", token }));
  lines.push(
    JSON.stringify({
      type: "user",
      message: { role: "user", content: text },
      from: "pmcp",
      msg_id: randomUUID(),
    }),
  );
  return `${lines.join("\n")}\n`;
}

function post(socket: string, payload: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const connection = createConnection(socket);
    const timer = setTimeout(
      () => connection.destroy(new Error("timed out")),
      5000,
    );
    connection.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    connection.on("connect", () => connection.end(payload));
    connection.on("close", (failed) => {
      clearTimeout(timer);
      if (!failed) resolve();
    });
  });
}

export const claudeInbox: Transport = {
  probe: (record, context) =>
    socketOf(record, context) ? "claude-inbox" : null,
  async wake(record, text, context): Promise<WakeResult> {
    const base = { session: record.session, runtime: "claude" };
    const file = socketOf(record, context);
    if (!file?.messagingSocketPath)
      return {
        ...base,
        outcome: "not-wakeable",
        detail: "no live Claude session file with an inbox socket",
      };
    try {
      await post(
        file.messagingSocketPath,
        frames(text, file.messagingSocketPath, context.env),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ...base,
        outcome: "failed",
        transport: "claude-inbox",
        detail: reason,
      };
    }
    // Claude Code applies the target's own inbound controls; pmcp never changes them.
    const detail =
      `posted to ${file.messagingSocketPath} (target ${file.status ?? "unknown"}); ` +
      "a target in bypassPermissions without crossSessionInbound accept holds it for approval";
    return { ...base, outcome: "woken", transport: "claude-inbox", detail };
  },
};
