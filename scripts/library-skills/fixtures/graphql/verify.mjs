import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

async function packageVersion(require, name) {
  let directory = dirname(require.resolve(name));
  for (;;) {
    try {
      const manifest = JSON.parse(
        await readFile(join(directory, "package.json"), "utf8"),
      );
      if (manifest.name === name) return manifest.version;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error(`Package manifest not found: ${name}`);
    directory = parent;
  }
}

export async function verify({ scratchRoot }) {
  assert.ok(scratchRoot, "Pass an isolated dependency workspace path");
  const root = resolve(scratchRoot);
  const require = createRequire(join(root, "package.json"));
  const {
    graphql,
    parse,
    validate,
    execute,
    validateSchema,
    buildSchema,
  } = require("graphql");
  const packages = {};
  for (const name of ["graphql", "graphql-yoga", "@pothos/core"]) {
    packages[name] = await packageVersion(require, name);
  }
  assert.deepEqual(packages, {
    graphql: "16.13.1",
    "graphql-yoga": "5.22.0",
    "@pothos/core": "4.13.1",
  });
  assert.equal(require("typescript").version, "5.9.3");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "graphql-"));
  await cp(new URL("./project/", import.meta.url), directory, {
    recursive: true,
  });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  execFileSync(
    process.execPath,
    [
      require.resolve("typescript/bin/tsc"),
      "-p",
      join(directory, "tsconfig.json"),
      "--pretty",
      "false",
    ],
    {
      cwd: directory,
      timeout: 45_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
    },
  );
  const { schema } = await import(
    pathToFileURL(join(directory, "dist", "schema.js")).href
  );
  const { yoga } = await import(
    pathToFileURL(join(directory, "dist", "server.js")).href
  );
  const checks = ["Pothos typed schema and rejected numeric String resolver"];
  assert.deepEqual(validateSchema(schema), []);
  assert.equal(
    schema.getQueryType().getFields().greeting.type.toString(),
    "String!",
  );
  checks.push("complete schema validation and explicit field nullability");
  const invalidSchema = buildSchema("type Query { __reserved: String }");
  assert.equal(validateSchema(invalidSchema).length, 1);
  checks.push("reserved schema field rejected before serving");
  const source =
    "query Greeting($name: String!) { greeting(name: $name) requestId }";
  const result = await graphql({
    schema,
    source,
    variableValues: { name: "Ada" },
    contextValue: { requestId: "direct" },
  });
  assert.equal(result.errors, undefined);
  assert.equal(result.data.greeting, "Hello Ada");
  assert.equal(result.data.requestId, "direct");
  checks.push("typed Pothos schema executes through GraphQL16");
  const invalid = await graphql({
    schema,
    source,
    variableValues: { name: 42 },
    contextValue: { requestId: "direct" },
  });
  assert.equal(invalid.data, undefined);
  assert.ok(invalid.errors?.length);
  const unknown = validate(schema, parse("{ missing }"));
  assert.equal(unknown.length, 1);
  checks.push("invalid variables and unknown document fields rejected");
  const document = parse(source);
  assert.deepEqual(validate(schema, document), []);
  const executed = await execute({
    schema,
    document,
    variableValues: { name: "Grace" },
    contextValue: { requestId: "parsed" },
  });
  assert.equal(executed.errors, undefined);
  assert.equal(executed.data.greeting, "Hello Grace");
  checks.push("parse validate execute sequence");
  for (const requestId of ["first", "second"]) {
    const response = await yoga.fetch("http://fixture/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-request-id": requestId,
      },
      body: JSON.stringify({ query: source, variables: { name: "Ada" } }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      data: { greeting: "Hello Ada", requestId },
    });
  }
  checks.push("Yoga Fetch requests isolate per-request Pothos context");
  const failedResponse = await yoga.fetch("http://fixture/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "{ failure }" }),
  });
  const failedBody = await failedResponse.json();
  assert.equal(failedBody.data.failure, null);
  assert.ok(failedBody.errors?.length);
  assert.ok(!JSON.stringify(failedBody).includes("fixture-private-error"));
  checks.push("Yoga masks unexpected resolver details in GraphQL response");
  return {
    productId: "graphql",
    companionProductIds: ["graphql-yoga", "pothos-core"],
    verifiedOn: new Date().toISOString().slice(0, 10),
    verifiedVersions: [packages.graphql],
    packages,
    examplesExecuted: checks.length,
    checks,
    environment: `Node ${process.versions.node}; in-process Fetch handler and TypeScript`,
    evidenceDirectory: directory,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = await verify({ scratchRoot: process.argv[2] });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
