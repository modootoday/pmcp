import { spawn } from "node:child_process";

export async function runBounded(entry, scratchRoot, directory) {
  const child = spawn(process.execPath, [entry, scratchRoot], {
    cwd: directory,
    env: {
      PATH: process.env.PATH,
      HOME: directory,
      XDG_CONFIG_HOME: directory,
      XDG_CACHE_HOME: directory,
      TMPDIR: directory,
      CI: "1",
      NO_COLOR: "1",
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let expired = false;
  function stop() {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  function limit() {
    if (stdout.length + stderr.length <= 256 * 1024) return;
    expired = true;
    stop();
  }
  const timeout = setTimeout(() => {
    expired = true;
    stop();
  }, 30000);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    limit();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    limit();
  });
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (expired) throw new Error("Fixture exceeded its time or output bound");
    if (code !== 0)
      throw new Error(`Fixture exited ${code}: ${stderr}${stdout}`);
    return JSON.parse(stdout);
  } finally {
    clearTimeout(timeout);
  }
}
