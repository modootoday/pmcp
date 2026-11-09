import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import { endQuietlyOnClosedPipe } from "../src/cli/pipe.js";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

function failure(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`write ${code}`), { code });
}

it("ends with exit 0 when the reader closed the pipe, and rethrows other write errors", () => {
  const stream = new EventEmitter();
  const exits: number[] = [];
  endQuietlyOnClosedPipe([stream], (code) => exits.push(code));
  stream.emit("error", failure("EPIPE"));
  expect(exits).toEqual([0]);
  expect(() => stream.emit("error", failure("ENOSPC"))).toThrow("write ENOSPC");
});

it("prints no stack trace when stdout is closed before the command writes", async () => {
  const child = spawn("bun", [CLI, "--help"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  child.stdout.destroy();
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += String(chunk)));
  const code = await new Promise<number | null>((resolve) =>
    child.on("exit", (exit) => resolve(exit)),
  );
  expect(stderr).not.toContain("EPIPE");
  expect(code).toBe(0);
}, 30_000);
