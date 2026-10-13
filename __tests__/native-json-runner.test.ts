import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { isOpenCodeInventory } from "../src/project/adapters/opencode-doctor.js";
import { nativeJsonRunner } from "../src/project/diagnostics/native-json.js";

function fixture(source: string): { root: string; file: string } {
  const root = mkdtempSync(join(tmpdir(), "pmcp-native-json-fixture-"));
  const file = join(root, "native.mjs");
  writeFileSync(file, source);
  return { root, file };
}

describe("native JSON inventory capture", () => {
  it("collects a large immediately exiting native response without mixing ANSI stderr and removes its private capture", (t) => {
    const state = fixture(`
import { fstatSync, readlinkSync } from "node:fs";
const path = process.platform === "linux" ? readlinkSync("/proc/self/fd/1") : undefined;
const value = "한".repeat(200000);
process.stdout.write(JSON.stringify({ value, path, mode: fstatSync(1).mode & 0o777 }));
process.stderr.write("\\u001b[0m\\n");
process.exit(0);
`);
    t.onTestFinished(() =>
      rmSync(state.root, { recursive: true, force: true }),
    );
    const result = nativeJsonRunner(process.execPath, [state.file], state.root);
    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.value).toBe("한".repeat(200000));
    if (process.platform !== "win32") expect(payload.mode).toBe(0o600);
    if (payload.path) {
      expect(existsSync(payload.path)).toBe(false);
      expect(existsSync(dirname(payload.path))).toBe(false);
    }
    expect(isOpenCodeInventory("opencode", ["debug", "skill"])).toBe(true);
    expect(isOpenCodeInventory("opencode", ["mcp", "list"])).toBe(false);
  });

  it("preserves a missing executable verdict", (t) => {
    const state = fixture("");
    t.onTestFinished(() =>
      rmSync(state.root, { recursive: true, force: true }),
    );
    const result = nativeJsonRunner(
      join(state.root, "missing"),
      [],
      state.root,
    );
    expect(result.missing).toBe(true);
    expect(result.status).toBe(null);
  });

  it("reports a native failure without exposing its partial inventory body", (t) => {
    const state = fixture(`
process.stdout.write("PRIVATE_PARTIAL_BODY");
process.stderr.write("native inventory failed");
process.exit(7);
`);
    t.onTestFinished(() =>
      rmSync(state.root, { recursive: true, force: true }),
    );
    const result = nativeJsonRunner(process.execPath, [state.file], state.root);
    expect(result.status).toBe(7);
    expect(result.stdout).toBe("native inventory failed");
    expect(result.stdout).not.toContain("PRIVATE_PARTIAL_BODY");
  });

  it("refuses oversized sparse output before reading it into memory", (t) => {
    const state = fixture(`
import { ftruncateSync } from "node:fs";
ftruncateSync(1, (1 << 26) + 1);
`);
    t.onTestFinished(() =>
      rmSync(state.root, { recursive: true, force: true }),
    );
    const result = nativeJsonRunner(process.execPath, [state.file], state.root);
    expect(result.status).toBe(null);
    expect(result.stdout).toBe("Native JSON output exceeds 64 MiB");
  });
});
