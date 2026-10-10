import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runBounded } from "../mcp1/inputs/process.mjs";
import { readPackageVersion } from "../mcp1/inputs/versions.mjs";

export async function verify({ scratchRoot }) {
  const root = resolve(scratchRoot);
  const require = createRequire(join(root, "package.json"));
  const serverVersion = await readPackageVersion(
    require,
    "@modelcontextprotocol/server",
    "@modelcontextprotocol/server",
  );
  const clientVersion = await readPackageVersion(
    require,
    "@modelcontextprotocol/client",
    "@modelcontextprotocol/client",
  );
  const zodVersion = require("zod/package.json").version;
  assert.equal(serverVersion, "2.0.0");
  assert.equal(clientVersion, "2.0.0");
  assert.equal(zodVersion, "4.6.5");
  const directory = await mkdtemp(join(root, "mcp2-"));
  try {
    await cp(new URL("./inputs/", import.meta.url), directory, {
      recursive: true,
    });
    await cp(
      new URL("../mcp1/inputs/server.mjs", import.meta.url),
      join(directory, "server.mjs"),
    );
    const { checks } = await runBounded(
      join(directory, "roundtrip.mjs"),
      root,
      directory,
    );
    return {
      productId: "modelcontextprotocol-server",
      major: 2,
      versions: {
        "@modelcontextprotocol/server": serverVersion,
        "@modelcontextprotocol/client": clientVersion,
        zod: zodVersion,
      },
      examplesExecuted: checks.length,
      checks,
      runtime:
        "MCP 2026-07-28 in-process HTTP serialization with the real client and handler; no socket, stdio or OAuth",
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
