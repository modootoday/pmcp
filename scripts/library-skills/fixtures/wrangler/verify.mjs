import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkTypes } from "../workers/compiler.mjs";
import { runBounded } from "./process.mjs";

export async function verify({ scratchRoot }) {
  scratchRoot = resolve(scratchRoot);
  const require = createRequire(join(scratchRoot, "package.json"));
  const packagePath = require.resolve("wrangler/package.json");
  const manifest = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(manifest.version, "4.90.1");
  const directory = await mkdtemp(join(scratchRoot, "wrangler-"));
  try {
    await cp(new URL("./project/", import.meta.url), directory, {
      recursive: true,
    });
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    const cli = join(dirname(packagePath), manifest.bin.wrangler);
    const configPath = join(directory, "wrangler.json");
    const generated = join(directory, "worker-configuration.d.ts");
    const args = [cli, "types", generated, "--config", configPath];
    await runBounded(args, directory);
    await runBounded([...args, "--check"], directory);
    await checkTypes(
      require,
      directory,
      "valid",
      [generated, join(directory, "contracts.ts")],
      { lib: ["ES2022"] },
    );
    await checkTypes(
      require,
      directory,
      "invalid",
      [generated, join(directory, "invalid.ts")],
      { lib: ["ES2022"] },
      [2339, 2345],
    );
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.vars.MODE = "changed";
    await writeFile(configPath, JSON.stringify(config));
    await runBounded([...args, "--check"], directory, 1);
    config.vars.MODE = "fixture";
    await writeFile(configPath, JSON.stringify(config));
    const output = await runBounded(
      [
        fileURLToPath(new URL("./runtime.mjs", import.meta.url)),
        scratchRoot,
        directory,
      ],
      directory,
    );
    const resultLine = output.trim().split("\n").at(-1);
    const runtime = JSON.parse(resultLine);
    const checks = [
      "configuration-driven Env and runtime type generation",
      "unchanged type inputs accepted",
      "generated KV and variable contracts compile",
      "unknown binding rejected",
      "invalid KV payload rejected",
      "configuration drift rejected",
      ...runtime.checks,
    ];
    return {
      productId: "wrangler",
      major: 4,
      versions: { wrangler: manifest.version },
      examplesExecuted: checks.length,
      checks,
      runtime:
        "isolated local workerd with in-memory KV; no remote bindings or deployment",
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
