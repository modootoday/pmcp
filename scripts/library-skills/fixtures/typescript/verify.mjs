import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const sourceRoot = fileURLToPath(new URL("./project/", import.meta.url));

function parseConfiguration(path) {
  const config = ts.readConfigFile(path, ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    resolve(path, ".."),
  );
  assert.equal(parsed.errors.length, 0);
  return parsed;
}

function checkProject(path, overrideFile, expectedCode) {
  const parsed = parseConfiguration(path);
  const rootNames = overrideFile ? [overrideFile] : parsed.fileNames;
  const program = ts.createProgram({ rootNames, options: parsed.options });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (expectedCode) {
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].code, expectedCode);
    return;
  }

  const errors = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getCanonicalFileName: (name) => name,
    getNewLine: () => "\n",
  });
  assert.equal(diagnostics.length, 0, errors);
}

export async function verify({ scratchRoot = tmpdir() } = {}) {
  assert.equal(ts.version, "5.9.3");
  await mkdir(scratchRoot, { recursive: true });
  const directory = await mkdtemp(join(scratchRoot, "pmcp-typescript-"));
  await cp(sourceRoot, directory, { recursive: true });
  const library = join(directory, "library");
  for (const consumer of ["consumer-node", "consumer-bundler"]) {
    const scope = join(directory, consumer, "node_modules", "@pmcp-fixture");
    await mkdir(scope, { recursive: true });
    await symlink(library, join(scope, "typed-library"), "dir");
  }

  const buildDiagnostics = [];
  const host = ts.createSolutionBuilderHost(ts.sys, undefined, (diagnostic) => {
    buildDiagnostics.push(diagnostic);
  });
  const builder = ts.createSolutionBuilder(
    host,
    [join(directory, "tsconfig.json")],
    {},
  );
  assert.equal(builder.build(), ts.ExitStatus.Success);
  assert.equal(buildDiagnostics.length, 0);
  const declarations = await readFile(
    join(library, "dist", "index.d.ts"),
    "utf8",
  );
  assert.match(declarations, /\.\/math\.js/);
  checkProject(join(directory, "consumer-node", "tsconfig.json"));
  checkProject(join(directory, "consumer-bundler", "tsconfig.json"));
  checkProject(
    join(directory, "consumer-node", "tsconfig.json"),
    join(directory, "consumer-node", "invalid-type.mts"),
    2322,
  );
  checkProject(
    join(directory, "consumer-node", "tsconfig.json"),
    join(directory, "consumer-node", "invalid-extension.mts"),
    2835,
  );
  const runtime = spawnSync(
    process.execPath,
    [join(directory, "consumer-node", "runtime.mjs")],
    {
      timeout: 20_000,
      encoding: "utf8",
    },
  );
  assert.equal(runtime.error, undefined);
  assert.equal(runtime.status, 0, runtime.stderr);
  return {
    productId: "typescript",
    verifiedOn: new Date().toISOString(),
    verifiedVersions: [ts.version],
    examplesExecuted: 6,
    environment: `Node ${process.versions.node}; TypeScript compiler API`,
    checks: [
      "referenced declaration build",
      "NodeNext consumer through package exports",
      "Bundler consumer through package exports",
      "invalid type rejected with TS2322",
      "extensionless NodeNext import rejected with TS2835",
      "emitted package runtime import",
    ],
    evidenceDirectory: directory,
  };
}

const invokedPath = process.argv[1];
if (
  invokedPath &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  const result = await verify();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
