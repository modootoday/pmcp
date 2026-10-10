import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { checkTypes } from "../workers/compiler.mjs";
import { verifyRouting } from "./runtime.mjs";

export async function verify({ scratchRoot }) {
  const require = createRequire(join(resolve(scratchRoot), "package.json"));
  const routerVersion = require("@tanstack/react-router/package.json").version;
  assert.equal(routerVersion, "1.170.33");
  const routerRequire = createRequire(
    require.resolve("@tanstack/react-router"),
  );
  const coreVersion = routerRequire(
    "@tanstack/router-core/package.json",
  ).version;
  const reactVersion = require("react/package.json").version;
  assert.equal(reactVersion, require("react-dom/package.json").version);
  const directory = await mkdtemp(join(scratchRoot, "router-"));
  try {
    await cp(new URL("./project/", import.meta.url), directory, {
      recursive: true,
    });
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    await checkTypes(
      require,
      directory,
      "valid",
      [join(directory, "routes.ts")],
      { lib: ["ES2022", "DOM"] },
    );
    await checkTypes(
      require,
      directory,
      "invalid",
      [join(directory, "invalid.ts")],
      { lib: ["ES2022", "DOM"] },
      [2322, 2322],
    );
    const runtimeChecks = await verifyRouting(require);
    const checks = [
      "registered route tree accepts typed navigation",
      "numeric route parameter rejected",
      "unknown route path rejected",
      ...runtimeChecks,
    ];
    return {
      productId: "tanstack-react-router",
      major: 1,
      versions: {
        "@tanstack/react-router": routerVersion,
        "@tanstack/router-core": coreVersion,
        react: reactVersion,
      },
      examplesExecuted: checks.length,
      checks,
      runtime:
        "Node memory history, React server rendering and TypeScript route contracts; no browser or generated file routes",
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
