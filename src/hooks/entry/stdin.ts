import { readFileSync, writeSync } from "node:fs";

const LIMIT = 16 * 1024 * 1024;

// Use file descriptors so short-lived hooks avoid loading the stream stack.
export function readStdin(): string {
  const bytes = readFileSync(0);
  if (bytes.length > LIMIT) throw new Error("Hook input too large");
  return bytes.toString("utf8");
}

export function writeStdout(text: string): void {
  if (text) writeSync(1, text);
}
