import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { checkTypes } from "./compiler.mjs";

export async function verify({ scratchRoot }) {
  const require = createRequire(join(resolve(scratchRoot), "package.json"));
  const packagePath = require.resolve("@cloudflare/workers-types/package.json");
  const version = JSON.parse(await readFile(packagePath, "utf8")).version;
  assert.equal(version, "4.20260702.1");
  const directory = await mkdtemp(join(scratchRoot, "workers-types-"));
  try {
    await cp(new URL("./project/", import.meta.url), directory, {
      recursive: true,
    });
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    const declarations = join(dirname(packagePath), "index.d.ts");
    await checkTypes(
      require,
      directory,
      "valid",
      [declarations, join(directory, "worker.ts")],
      { lib: ["ES2022"] },
    );
    await checkTypes(
      require,
      directory,
      "invalid",
      [declarations, join(directory, "invalid.ts")],
      { lib: ["ES2022"] },
      [2339, 2345],
    );
    return {
      productId: "cloudflare-workers-types",
      major: 4,
      versions: {
        "@cloudflare/workers-types": version,
        typescript: require("typescript/package.json").version,
      },
      examplesExecuted: 3,
      checks: [
        "typed Fetch handler and KV/service contracts",
        "unknown binding rejected",
        "invalid KV payload rejected",
      ],
      runtime: "TypeScript platform contracts; no Worker runtime emulation",
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
