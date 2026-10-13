import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("preserves native Bun identity through a HOME-dependent shim in a disposable profile", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "pmcp-bun-profile-"));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  const module = await import(
    new URL("../scripts/package-verification/bun-runtime.mjs", import.meta.url)
      .href
  );
  const executable = module.bunExecutable() as string;
  const original = execFileSync("bun", ["--version"], {
    encoding: "utf8",
  }).trim();
  const isolated = execFileSync("bun", ["--version"], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, BUN_REAL: executable },
  }).trim();
  expect(isolated).toBe(original);
});
