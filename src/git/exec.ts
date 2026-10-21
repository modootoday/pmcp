import { spawnSync } from "node:child_process";

import type { Argv } from "./types.js";

// Clear inherited git repository variables so nested calls target the requested checkout.
const LOCAL_ENV = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
];

export interface Result {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function cleanEnv(
  extra: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of LOCAL_ENV) delete env[name];
  return { ...env, ...extra };
}

export function git(
  cwd: string,
  args: Argv,
  extra?: Readonly<Record<string, string>>,
): Result {
  const run = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: cleanEnv(extra),
    maxBuffer: 256 * 1024 * 1024,
  });
  const stderr = run.stderr || run.error?.message || "";
  return { status: run.status ?? 1, stdout: run.stdout ?? "", stderr };
}

export function gitText(cwd: string, args: Argv): string {
  const run = git(cwd, args);
  if (run.status !== 0) return "";
  return run.stdout.trim();
}

export function gitOk(cwd: string, args: Argv): boolean {
  return git(cwd, args).status === 0;
}

// Streams the command's output to our stderr as it comes and appends it to log, so a long
// gate stays visible and its full output is kept. Exits with the command's status.
const TEE = `
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const [log, bin, ...args] = process.argv.slice(1);
const out = fs.openSync(log, "a");
const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
for (const stream of [child.stdout, child.stderr])
  stream.on("data", (chunk) => {
    process.stderr.write(chunk);
    fs.writeSync(out, chunk);
  });
child.on("error", (error) => {
  fs.writeSync(out, String(error) + "\\n");
  process.stderr.write(String(error) + "\\n");
  process.exit(127);
});
child.on("close", (code) => process.exit(code ?? 1));
`;

export function runCommandLogged(
  argv: Argv,
  cwd: string,
  log: string,
  extra?: Readonly<Record<string, string>>,
): number {
  if (argv[0] === undefined) return 0;
  const run = spawnSync(process.execPath, ["-e", TEE, log, ...argv], {
    cwd,
    stdio: ["ignore", 2, 2],
    env: cleanEnv(extra),
  });
  return run.status ?? 1;
}

export function runCommand(
  argv: Argv,
  cwd: string,
  extra?: Readonly<Record<string, string>>,
): number {
  const [bin, ...rest] = argv;
  if (bin === undefined) return 0;
  const run = spawnSync(bin, rest, {
    cwd,
    stdio: ["ignore", 2, 2],
    env: cleanEnv(extra),
  });
  return run.status ?? 1;
}
