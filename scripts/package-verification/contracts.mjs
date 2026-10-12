import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyMcp } from "./mcp.mjs";

export async function verifyContracts(installed, runtime) {
  assert.ok(["node", "bun"].includes(runtime));
  const cli = join(installed.installed, "dist/cli.js");
  const run = (args) =>
    execFileSync(runtime, [cli, ...args], {
      cwd: installed.project,
      env: installed.env,
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  assert.equal(run(["--version"]), installed.version);
  run(["--help"]);
  assert.ok(
    JSON.parse(run(["marketplace", "list", "--json"])).plugins.length > 0,
  );
  const fixture = fileURLToPath(
    new URL("./installed-entry.mjs", import.meta.url),
  );
  const result = execFileSync(runtime, [fixture, installed.installed], {
    cwd: installed.project,
    env: installed.env,
    encoding: "utf8",
    timeout: 15_000,
  }).trim();
  const entry = JSON.parse(result);
  assert.equal(
    entry.sqliteProvider,
    runtime === "bun" ? "bun:sqlite" : "node:sqlite",
  );
  return {
    cliVersion: installed.version,
    ...entry,
    mcp: await verifyMcp(runtime, cli, installed.project, installed.env),
    providerRequests: 0,
    runtime: execFileSync(runtime, ["--version"], {
      env: installed.env,
      encoding: "utf8",
    }).trim(),
  };
}
