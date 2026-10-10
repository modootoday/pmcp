import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { privateJson, readPrivateJson } from "../../groups/store.js";
import { object, strings, text } from "../../validation.js";

const path = text(process.argv[2], "launch_path");
const spec = object(readPrivateJson(path));
const argv = strings(spec.argv, "argv");
const witness = join(
  dirname(path),
  `${text(spec.id, "session_id")}.process.json`,
);
const startedAt = new Date().toISOString();
privateJson(witness, { id: spec.id, pid: process.pid, startedAt });
const child = spawn(text(argv[0], "runtime_executable"), argv.slice(1), {
  cwd: text(spec.cwd, "cwd"),
  stdio: "inherit",
  env: process.env,
});
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => {});
child.on("error", (error: NodeJS.ErrnoException) => {
  privateJson(witness, {
    id: spec.id,
    startedAt,
    exitedAt: new Date().toISOString(),
    error: error.code,
  });
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  privateJson(witness, {
    id: spec.id,
    startedAt,
    exitedAt: new Date().toISOString(),
    code,
    signal,
  });
  process.exitCode = code ?? 1;
});
