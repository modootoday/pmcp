import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runBounded } from "../mcp1/inputs/process.mjs";

export async function verify({ scratchRoot }) {
  const root = resolve(scratchRoot);
  const require = createRequire(join(root, "package.json"));
  const version = require("bcryptjs/package.json").version;
  assert.equal(version, "2.4.3");
  const directory = await mkdtemp(join(root, "bcrypt-"));
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
      productId: "bcryptjs",
      major: 2,
      versions: { bcryptjs: version },
      examplesExecuted: checks.length,
      checks,
      runtime:
        "Local bcrypt hash, async comparison and UTF-8 input guards; cost 4 is for fixture speed only",
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
