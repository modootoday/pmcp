import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSkillHttpHandler,
  readCatalog,
  verifiedRuntimesOf,
  type CatalogOptions,
  type Runtime,
  type SkillEntry,
} from "../src/http.js";

const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("HTTP catalog entry", () => {
  it("exports typed catalog and runtime helpers with declaration order", () => {
    const options: CatalogOptions = { roots: [] };
    const entries: SkillEntry[] = readCatalog(options);
    const runtimes: Runtime[] = verifiedRuntimesOf({
      "verified-runtimes": "grok-cli,codex-cli unknown grok-cli",
    });
    expect(entries).toEqual([]);
    expect(runtimes).toEqual(["grok-cli", "codex-cli"]);
  });

  it("reports rejected marketplaces during startup and reload", async () => {
    const path = mkdtempSync(join(tmpdir(), "pmcp-http-catalog-"));
    directories.push(path);
    const rejected: { path: string; reason: string }[] = [];
    const handler = createSkillHttpHandler({
      roots: [],
      marketplaces: [path],
      onReject: (rejection) => rejected.push(rejection),
      authorize: () => undefined,
    });
    expect(await handler.ready()).toBe("lexical");
    expect(rejected).toEqual([
      { path, reason: "No supported native marketplace.json found" },
    ]);
    handler.reload();
    expect(rejected).toHaveLength(2);
    expect(rejected[1]).toEqual(rejected[0]);
  });

  it("passes rejection options to an explicitly forwarding catalog loader", () => {
    const rejected: { path: string; reason: string }[] = [];
    const handler = createSkillHttpHandler({
      roots: [],
      onReject: (rejection) => rejected.push(rejection),
      loadCatalog: (options) => {
        options.onReject?.({ path: "fixture", reason: "rejected" });
        return [];
      },
      authorize: () => undefined,
    });
    handler.reload();
    expect(rejected).toEqual([
      { path: "fixture", reason: "rejected" },
      { path: "fixture", reason: "rejected" },
    ]);
  });
});
