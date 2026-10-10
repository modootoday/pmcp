import { spawn } from "node:child_process";

export async function runBounded(args, directory, expectedStatus = 0) {
  const env = {
    PATH: process.env.PATH,
    HOME: directory,
    XDG_CONFIG_HOME: directory,
    XDG_CACHE_HOME: directory,
    TMPDIR: directory,
    CI: "1",
    WRANGLER_SEND_METRICS: "false",
    NO_COLOR: "1",
  };
  const child = spawn(process.execPath, args, {
    cwd: directory,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let expired = false;
  function stop() {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  const timeout = setTimeout(() => {
    expired = true;
    stop();
  }, 60000);
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      output += chunk;
      if (output.length > 1024 * 1024) {
        expired = true;
        stop();
      }
    });
  }
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (expired)
      throw new Error("Fixture subprocess exceeded its time or output bound");
    if (code !== expectedStatus)
      throw new Error(`Fixture subprocess exited ${code}: ${output}`);
    return output;
  } finally {
    clearTimeout(timeout);
  }
}
