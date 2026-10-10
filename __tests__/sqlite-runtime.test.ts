import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const bunAvailable =
  spawnSync("bun", ["--version"], { timeout: 5000 }).status === 0;

it.skipIf(!bunAvailable)(
  "loads the built CLI and selects Bun SQLite without resolving Node SQLite",
  () => {
    const version = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ).version;
    const cli = spawnSync("bun", [join(root, "dist/cli.js"), "--version"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(cli.status, cli.stderr).toBe(0);
    expect(cli.stdout.trim()).toBe(version);
    const script = [
      "const { openIntentCache } = await import(process.argv[1]);",
      'const cache = await openIntentCache({ path: ":memory:", modelId: "fixture", dims: 2 });',
      'if (!cache) throw new Error("SQLite cache unavailable");',
      "console.log(cache.stats().provider);",
      "cache.close();",
    ].join("\n");
    const cache = spawnSync(
      "bun",
      ["--eval", script, pathToFileURL(join(root, "dist/index.js")).href],
      {
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(cache.status, cache.stderr).toBe(0);
    expect(cache.stdout.trim()).toBe("bun:sqlite");
  },
);
