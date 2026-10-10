import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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
  const script = [
    "const { openIntentCache } = await import(process.argv[1]);",
    'const cache = await openIntentCache({ path: ":memory:", modelId: "fixture", dims: 2 });',
    'if (!cache) throw new Error("SQLite unavailable");',
    'cache.put("packed fixture", new Float32Array([1, 2]));',
    'if (cache.get("packed fixture")?.[1] !== 2) throw new Error("SQLite roundtrip failed");',
    "console.log(cache.stats().provider);",
    "cache.close();",
  ].join("\n");
  const provider = execFileSync(
    runtime,
    [
      "--eval",
      script,
      pathToFileURL(join(installed.installed, "dist/index.js")).href,
    ],
    {
      cwd: installed.project,
      env: installed.env,
      encoding: "utf8",
      timeout: 15_000,
    },
  ).trim();
  assert.equal(provider, runtime === "bun" ? "bun:sqlite" : "node:sqlite");
  return {
    cliVersion: installed.version,
    sqliteProvider: provider,
    mcp: await verifyMcp(runtime, cli, installed.project, installed.env),
    providerRequests: 0,
    runtime: execFileSync(runtime, ["--version"], {
      env: installed.env,
      encoding: "utf8",
    }).trim(),
  };
}
