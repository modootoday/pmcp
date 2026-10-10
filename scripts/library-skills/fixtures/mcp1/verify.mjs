import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runBounded } from "./inputs/process.mjs";
import { readPackageVersion } from "./inputs/versions.mjs";

export async function verify({ scratchRoot }) {
  const root = resolve(scratchRoot);
  const require = createRequire(join(root, "package.json"));
  const sdkVersion = await readPackageVersion(
    require,
    "@modelcontextprotocol/sdk",
    "@modelcontextprotocol/sdk/server/mcp.js",
  );
  const zodVersion = require("zod/package.json").version;
  assert.equal(sdkVersion, "1.30.0");
  assert.equal(zodVersion, "3.25.76");
  const directory = await mkdtemp(join(root, "mcp1-"));
  try {
    await cp(new URL("./inputs/", import.meta.url), directory, {
      recursive: true,
    });
    const { checks } = await runBounded(
      join(directory, "roundtrip.mjs"),
      root,
      directory,
    );
    return {
      productId: "modelcontextprotocol-sdk",
      major: 1,
      versions: { "@modelcontextprotocol/sdk": sdkVersion, zod: zodVersion },
      examplesExecuted: checks.length,
      checks,
      runtime: "Paired in-process MCP v1 transport; no HTTP, stdio or OAuth",
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (!process.argv[2])
    throw new Error("Pass an isolated dependency workspace path");
  console.log(JSON.stringify(await verify({ scratchRoot: process.argv[2] })));
}
