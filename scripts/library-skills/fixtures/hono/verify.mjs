import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { verifyNativeServer } from "./native-server.mjs";

export async function verify({ scratchRoot }) {
  const require = createRequire(join(scratchRoot, "package.json"));
  const { Hono } = require("hono");
  const { validator } = require("hono/validator");
  const { serve } = require("@hono/node-server");
  const packageRoot = resolve(dirname(require.resolve("hono")), "../..");
  const version = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  ).version;
  const directory = join(scratchRoot, "hono");
  await mkdir(directory, { recursive: true });
  const calls = [];
  const app = new Hono();
  app.use("*", async (c, next) => {
    calls.push("before");
    await next();
    calls.push("after");
  });
  app.post(
    "/items",
    validator("json", (value, c) => {
      if (typeof value?.title !== "string")
        return c.json({ error: "title" }, 400);
      return { title: value.title };
    }),
    (c) => c.json({ title: c.req.valid("json").title }, 201),
  );
  const accepted = await app.request("/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "first" }),
  });
  assert.equal(accepted.status, 201);
  assert.deepEqual(await accepted.json(), { title: "first" });
  assert.deepEqual(calls, ["before", "after"]);
  const rejected = await app.request("/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: 42 }),
  });
  assert.equal(rejected.status, 400);
  assert.deepEqual(await rejected.json(), { error: "title" });
  assert.equal((await app.request("/missing")).status, 404);
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  const server = await readFile(
    new URL("./project/server.ts", import.meta.url),
    "utf8",
  );
  const client = await readFile(
    new URL("./project/client.ts", import.meta.url),
    "utf8",
  );
  await writeFile(join(directory, "server.ts"), server);
  await writeFile(join(directory, "client.ts"), client);
  await writeFile(
    join(directory, "tsconfig.server.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
        declaration: true,
        emitDeclarationOnly: true,
        outDir: "dist",
        skipLibCheck: true,
      },
      files: ["server.ts"],
    }),
  );
  await writeFile(
    join(directory, "tsconfig.client.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
        noEmit: true,
        skipLibCheck: true,
      },
      files: ["client.ts"],
    }),
  );
  const compiler = require.resolve("typescript/bin/tsc");
  for (const name of ["server", "client"]) {
    execFileSync(
      process.execPath,
      [compiler, "-p", join(directory, "tsconfig." + name + ".json")],
      { cwd: directory, encoding: "utf8", timeout: 60000 },
    );
  }
  const nativeChecks = await verifyNativeServer(app, serve);
  const adapterRoot = resolve(
    dirname(require.resolve("@hono/node-server")),
    "..",
  );
  const adapterVersion = JSON.parse(
    await readFile(join(adapterRoot, "package.json"), "utf8"),
  ).version;
  return {
    productId: "hono",
    major: 4,
    versions: { hono: version, "@hono/node-server": adapterVersion },
    checks: 8 + nativeChecks,
    examplesExecuted: 8 + nativeChecks,
    runtime:
      "Node requests, native HTTP lifecycle and TypeScript RPC declarations",
  };
}

if (
  resolve(process.argv[1] ?? "") === resolve(new URL(import.meta.url).pathname)
) {
  console.log(
    JSON.stringify(await verify({ scratchRoot: resolve(process.argv[2]) })),
  );
}
