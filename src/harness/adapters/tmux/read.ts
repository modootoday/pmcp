import { integer } from "../../validation.js";
import type { Connection } from "./connection.js";

export function read(
  connection: Connection,
  id: string,
  options: { lines?: number; maxBytes?: number; alternate?: boolean } = {},
): { content: string; source: string; truncated: boolean } {
  const lines = integer(options.lines ?? 100, "lines", 1, 2000);
  const maxBytes = integer(options.maxBytes ?? 16_384, "max_bytes", 1, 65_536);
  const session = connection.inspect(id);
  const flags = options.alternate === true ? ["-a"] : ["-S", `-${lines}`];
  const output = connection.tmux([
    "capture-pane",
    "-p",
    "-J",
    "-t",
    session.paneId,
    ...flags,
  ]);
  const bytes = Buffer.from(output);
  const truncated = bytes.length > maxBytes;
  const content = truncated
    ? bytes
        .subarray(bytes.length - maxBytes)
        .toString("utf8")
        .replace(/^\uFFFD+/, "")
    : output;
  return { content, source: "terminal-screen", truncated };
}
