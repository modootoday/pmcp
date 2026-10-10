import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { nodeRows, webRows } from "./streams.mjs";

function isolatedEndpoint(value) {
  assert.ok(
    value,
    "Pass clickhouseUrl or PMCP_SKILL_CLICKHOUSE_URL for an isolated test service",
  );
  const endpoint = new URL(value);
  assert.ok(["http:", "https:"].includes(endpoint.protocol));
  assert.ok(
    ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname),
    "Only explicit loopback test endpoints are permitted",
  );
  assert.equal(endpoint.pathname, "/");
  assert.ok(endpoint.port, "An explicit isolated service port is required");
  assert.equal(endpoint.search, "");
  assert.equal(endpoint.username, "");
  assert.equal(endpoint.password, "");
  return endpoint;
}

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

export async function verify({
  scratchRoot,
  clickhouseUrl = process.env.PMCP_SKILL_CLICKHOUSE_URL,
  username = "default",
  password = "",
}) {
  assert.ok(scratchRoot, "Pass an isolated dependency workspace path");
  const endpoint = isolatedEndpoint(clickhouseUrl);
  const root = resolve(scratchRoot);
  const require = createRequire(join(root, "package.json"));
  const { createClient: createNodeClient } = require("@clickhouse/client");
  const { createClient: createWebClient } = require("@clickhouse/client-web");
  const packages = {};
  for (const name of ["@clickhouse/client", "@clickhouse/client-web"])
    packages[name] = await packageVersion(require, name);
  assert.deepEqual(packages, {
    "@clickhouse/client": "1.23.1",
    "@clickhouse/client-web": "1.23.1",
  });
  assert.equal(require("typescript").version, "5.9.3");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "clickhouse-"));
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
  const checks = [
    "Node and web consumer types accept shared keep-alive enabled and reject web socket TTL and Node stream inserts",
  ];
  const database = `pmcp_verify_${randomUUID().replaceAll("-", "")}`;
  const settings = {
    max_execution_time: 5,
    max_memory_usage: 32 * 1024 * 1024,
    max_result_rows: 100,
    result_overflow_mode: "throw",
  };
  const common = {
    url: endpoint.href,
    username,
    password,
    request_timeout: 10_000,
    clickhouse_settings: settings,
  };
  const control = createNodeClient({
    ...common,
    database: "system",
    max_open_connections: 1,
  });
  let node;
  let web;
  let created = false;
  try {
    await control.command({
      query: `CREATE DATABASE ${database}`,
      query_id: randomUUID(),
    });
    created = true;
    node = createNodeClient({ ...common, database, max_open_connections: 1 });
    web = createWebClient({ ...common, database });
    await node.command({
      query: "CREATE TABLE rows (id UInt64, label String) ENGINE = Memory",
      query_id: randomUUID(),
    });
    checks.push("SDK creates a uniquely owned isolated database and table");
    const exact = "18446744073709551615";
    const literal = "Ada'; DROP TABLE rows; --";
    await node.insert({
      table: "rows",
      values: [{ id: exact, label: literal }],
      format: "JSONEachRow",
      query_id: randomUUID(),
    });
    const result = await node.query({
      query: "SELECT id, label FROM rows WHERE label = {label:String}",
      query_params: { label: literal },
      format: "JSONEachRow",
      query_id: randomUUID(),
    });
    assert.deepEqual(await result.json(), [{ id: exact, label: literal }]);
    checks.push(
      "Node SDK insert and typed parameters preserve literal values and UInt64 strings",
    );
    await web.insert({
      table: "rows",
      values: [{ id: "2", label: "web" }],
      format: "JSONEachRow",
      query_id: randomUUID(),
    });
    const webResult = await web.query({
      query: "SELECT id, label FROM rows WHERE id = {id:UInt64}",
      query_params: { id: "2" },
      format: "JSONEachRow",
      query_id: randomUUID(),
    });
    assert.deepEqual(await webResult.json(), [{ id: "2", label: "web" }]);
    checks.push("web SDK array insert and Fetch-backed query under Node");
    const expected = [
      { id: "2", label: "web" },
      { id: exact, label: literal },
    ];
    const streamed = await node.query({
      query: "SELECT id, label FROM rows ORDER BY id",
      format: "JSONEachRow",
      query_id: randomUUID(),
    });
    assert.deepEqual(await nodeRows(streamed), expected);
    checks.push("Node Readable query stream is fully consumed");
    const webStreamed = await web.query({
      query: "SELECT id, label FROM rows ORDER BY id",
      format: "JSONEachRow",
      query_id: randomUUID(),
    });
    assert.deepEqual(await webRows(webStreamed), expected);
    checks.push(
      "web ReadableStream query is fully consumed and reader released",
    );
    await assert.rejects(
      node.query({
        query: "SELECT missing FROM rows",
        format: "JSONEachRow",
        query_id: randomUUID(),
      }),
      /UNKNOWN_IDENTIFIER|Unknown expression|Unknown identifier/u,
    );
    checks.push("SDK query failure remains a rejection");
    const versionResult = await control.query({
      query: "SELECT version() AS version",
      format: "JSONEachRow",
      query_id: randomUUID(),
    });
    const [server] = await versionResult.json();
    await writeFile(
      join(directory, "server-version.json"),
      JSON.stringify(server),
    );
    return {
      productId: "clickhouse-client",
      companionProductIds: ["clickhouse-client-web"],
      verifiedOn: new Date().toISOString().slice(0, 10),
      verifiedVersions: [packages["@clickhouse/client"]],
      packages,
      examplesExecuted: checks.length,
      checks,
      environment: `Node ${process.versions.node}; ClickHouse ${server.version}; web SDK is not a browser or Worker test`,
      evidenceDirectory: directory,
    };
  } finally {
    const cleanupErrors = [];
    for (const client of [web, node]) {
      if (!client) continue;
      try {
        await client.close();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      if (created)
        await control.command({
          query: `DROP DATABASE ${database} SYNC`,
          query_id: randomUUID(),
        });
    } catch (error) {
      cleanupErrors.push(error);
    } finally {
      await control.close();
    }
    if (cleanupErrors.length)
      throw new AggregateError(
        cleanupErrors,
        "Owned ClickHouse fixture cleanup failed",
      );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = await verify({
    scratchRoot: process.argv[2],
    clickhouseUrl: process.argv[3],
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
