import { integer } from "../../validation.js";
import type { Connection } from "./connection.js";

// The last lines the session printed (its output ring, escapes stripped), or with alternate the
// screen as it is now; bounded the same way as before.
export function read(
  connection: Connection,
  id: string,
  options: { lines?: number; maxBytes?: number; alternate?: boolean } = {},
): { content: string; source: string; truncated: boolean } {
  const lines = integer(options.lines ?? 100, "lines", 1, 2000);
  const maxBytes = integer(options.maxBytes ?? 16_384, "max_bytes", 1, 65_536);
  const session = connection.inspect(id);
  let output: string;
  if (options.alternate === true) {
    const screen = connection.must({ op: "screen", id: session.ptySession });
    output = ((screen["rows"] ?? []) as string[]).join("\n");
  } else {
    const tail = connection.must({
      op: "tail",
      id: session.ptySession,
      bytes: 4 * maxBytes,
      strip: true,
    });
    output = String(tail["text"] ?? "")
      .replace(/\r\n?/gu, "\n")
      .split("\n")
      .slice(-lines)
      .join("\n");
  }
  const bytes = Buffer.from(output);
  const truncated = bytes.length > maxBytes;
  const content = truncated
    ? bytes
        .subarray(bytes.length - maxBytes)
        .toString("utf8")
        .replace(/^�+/, "")
    : output;
  return { content, source: "terminal-screen", truncated };
}
