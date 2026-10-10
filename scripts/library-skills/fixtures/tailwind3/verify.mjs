import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { packageVersions } from "../vite7/packages.mjs";

export async function verify({ scratchRoot }) {
  const require = createRequire(join(resolve(scratchRoot), "package.json"));
  const tailwindcss = require("tailwindcss");
  const postcss = require("postcss");
  const packages = await packageVersions(require, ["tailwindcss", "postcss"]);
  const directory = await mkdtemp(
    join(resolve(scratchRoot), "pmcp-tailwind3-"),
  );
  try {
    await cp(fileURLToPath(new URL("./project/", import.meta.url)), directory, {
      recursive: true,
    });
    const input = join(directory, "input.css");
    const result = await postcss([
      tailwindcss({
        content: [join(directory, "index.html")],
        theme: { extend: { colors: { accent: "#135790" } } },
      }),
    ]).process(await readFile(input, "utf8"), { from: input });
    assert.match(result.css, /\.grid\s*\{/);
    assert.match(result.css, /\.p-4\s*\{/);
    assert.match(result.css, /\.bg-accent\s*\{/);
    assert.match(result.css, /hover\\:bg-red-500:hover/);
    assert.ok(!result.css.includes(".p-72"));
    assert.equal(result.warnings().length, 0);
    return {
      productId: "tailwindcss",
      verifiedOn: new Date().toISOString(),
      verifiedVersions: [packages.tailwindcss],
      packages,
      examplesExecuted: 3,
      checks: [
        "content-selected utility generation",
        "theme extension and hover variant",
        "unused utility exclusion without warnings",
      ],
      environment: `Node ${process.versions.node}; Tailwind 3 PostCSS`,
      cleanedUp: true,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  console.log(JSON.stringify(await verify({ scratchRoot: process.argv[2] })));
}
