// A job's stdout and stderr kept in its ticket: log, rotated to log.1 once it would pass the
// cap, so one job keeps at most twice the cap however much it prints.

import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";

export const DEFAULT_JOB_LOG_BYTES = 4 * 1024 * 1024;

export class JobLog {
  private fd: number;
  private size: number;

  constructor(
    private readonly path: string,
    private readonly cap: number,
  ) {
    this.fd = openSync(path, "a");
    this.size = fstatSync(this.fd).size;
  }

  write(chunk: Buffer | string): void {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    try {
      if (this.size > 0 && this.size + bytes.length > this.cap) {
        closeSync(this.fd);
        renameSync(this.path, `${this.path}.1`);
        this.fd = openSync(this.path, "a");
        this.size = 0;
      }
      const kept =
        bytes.length > this.cap
          ? bytes.subarray(bytes.length - this.cap)
          : bytes;
      writeSync(this.fd, kept);
      this.size += kept.length;
    } catch {
      // Keeping a copy never stops the job.
    }
  }

  close(): void {
    try {
      closeSync(this.fd);
    } catch {
      // Already closed.
    }
  }
}

// The kept output, the rotated part first; tail keeps the last n lines.
export function readJobLog(path: string, tail?: number): string {
  const parts = [`${path}.1`, path]
    .filter((file) => existsSync(file))
    .map((file) => readFileSync(file, "utf8"));
  const text = parts.join("");
  if (tail === undefined) return text;
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-tail).join("\n") + (lines.length > 0 ? "\n" : "");
}
