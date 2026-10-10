import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

export async function verify({ scratchRoot }) {
  const require = createRequire(join(scratchRoot, "package.json"));
  const ts = require("typescript");
  const { z } = require("zod");
  const source = await readFile(
    new URL(
      "../../../../docs/skills/zod-schema-validation/4/SKILL.md",
      import.meta.url,
    ),
    "utf8",
  );
  const examples = [
    ...source.matchAll(
      /\x60\x60\x60ts pmcp-example\n([\s\S]*?)\n\x60\x60\x60/gu,
    ),
  ];
  const directory = join(scratchRoot, "zod");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  for (const [index, example] of examples.entries()) {
    const transpiled = ts.transpileModule(example[1], {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const path = join(directory, "example-" + index + ".mjs");
    await writeFile(path, transpiled);
    execFileSync(process.execPath, [path], {
      cwd: directory,
      encoding: "utf8",
      timeout: 10000,
    });
  }
  const AsyncTitle = z.string().transform(async (value) => value.trim());
  assert.equal(await AsyncTitle.parseAsync(" title "), "title");
  assert.throws(() => AsyncTitle.parse("title"));
  const inputOutput = await readFile(
    new URL("./types.ts", import.meta.url),
    "utf8",
  );
  await writeFile(join(directory, "types.ts"), inputOutput);
  await writeFile(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
        noEmit: true,
        skipLibCheck: true,
      },
      files: ["types.ts"],
    }),
  );
  execFileSync(
    process.execPath,
    [
      require.resolve("typescript/bin/tsc"),
      "-p",
      join(directory, "tsconfig.json"),
    ],
    { cwd: directory, encoding: "utf8", timeout: 60000 },
  );
  return {
    productId: "zod-schema-validation",
    major: 4,
    versions: { zod: require("zod/package.json").version },
    checks: examples.length + 3,
    examplesExecuted: examples.length + 3,
    runtime: "Standalone examples, async parsing and TypeScript input/output",
  };
}

if (
  resolve(process.argv[1] ?? "") === resolve(new URL(import.meta.url).pathname)
) {
  console.log(
    JSON.stringify(await verify({ scratchRoot: resolve(process.argv[2]) })),
  );
}
