import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function installPackage(archive, directory, manager) {
  assert.ok(["npm", "bun"].includes(manager));
  const stat = lstatSync(archive);
  assert.ok(stat.isFile() && stat.size < 16 * 1024 * 1024);
  const manifest = JSON.parse(
    execFileSync("tar", ["-xOf", archive, "package/package.json"], {
      encoding: "utf8",
      timeout: 10_000,
    }),
  );
  assert.equal(manifest.name, "@modootoday/pmcp");
  assert.equal(manifest.bin.pmcp, "dist/cli.js");
  const project = join(directory, "project");
  const home = join(directory, "home");
  for (const path of [project, home]) mkdirSync(path, { mode: 0o700 });
  const config = join(directory, "empty.npmrc");
  const globalConfig = join(directory, "empty-global.npmrc");
  writeFileSync(config, "", { mode: 0o600 });
  writeFileSync(globalConfig, "", { mode: 0o600 });
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    npm_config_userconfig: config,
    npm_config_globalconfig: globalConfig,
    npm_config_cache: join(directory, "npm-cache"),
    npm_config_registry: "https://registry.npmjs.org/",
    BUN_INSTALL_CACHE_DIR: join(directory, "bun-cache"),
    ...(process.env.BUN_REAL ? { BUN_REAL: process.env.BUN_REAL } : {}),
    NO_COLOR: "1",
  };
  writeFileSync(
    join(project, "package.json"),
    `${JSON.stringify({
      name: "pmcp-packed-verification",
      private: true,
      type: "module",
      dependencies: { [manifest.name]: `file:${archive}` },
    })}\n`,
  );
  const args = ["install", "--ignore-scripts", "--omit=optional"];
  if (manager === "npm") args.push("--no-audit", "--no-fund");
  if (manager === "bun") args.push("--no-progress");
  execFileSync(manager, args, {
    cwd: project,
    env,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const installed = join(project, "node_modules/@modootoday/pmcp");
  const actual = JSON.parse(
    readFileSync(join(installed, "package.json"), "utf8"),
  );
  assert.equal(actual.version, manifest.version);
  assert.deepEqual(actual.bin, manifest.bin);
  return {
    project,
    installed,
    env,
    version: manifest.version,
    archiveSha256: createHash("sha256")
      .update(readFileSync(archive))
      .digest("hex"),
    managerVersion: execFileSync(manager, ["--version"], {
      env,
      encoding: "utf8",
    }).trim(),
  };
}
