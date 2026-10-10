import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { RUNTIMES } from "../src/runtime.js";
import { locateExecutable } from "../src/harness/adapters/process/executable.js";
import { runtimeExecutables } from "../src/harness/runtimes/registry.js";

it("keeps harness executable names aligned with canonical runtime IDs", () => {
  expect(Object.keys(runtimeExecutables).sort()).toEqual([...RUNTIMES].sort());
  expect(runtimeExecutables.antigravity).toBe("agy");
});

it("rejects missing, non-executable and directory entries without executing them", () => {
  const directory = mkdtempSync(join(tmpdir(), "pmcp-executable-"));
  const previousPath = process.env.PATH;
  process.env.PATH = directory;
  try {
    mkdirSync(join(directory, "folder"));
    writeFileSync(join(directory, "plain"), "not executable", { mode: 0o600 });
    expect(locateExecutable("missing")).toBeNull();
    expect(locateExecutable("folder")).toBeNull();
    expect(locateExecutable("plain")).toBeNull();
  } finally {
    process.env.PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
});

it("resolves relative PATH entries against the native working directory", () => {
  const directory = mkdtempSync(join(tmpdir(), "pmcp-executable-"));
  const previousPath = process.env.PATH;
  process.env.PATH = "bin";
  try {
    const bin = join(directory, "bin");
    mkdirSync(bin);
    const target = join(bin, "native");
    writeFileSync(target, "not invoked", { mode: 0o700 });
    expect(locateExecutable("native", directory)).toBe(target);
    const alias = join(bin, "alias");
    symlinkSync(target, alias);
    expect(locateExecutable("alias", directory)).toBe(alias);
  } finally {
    process.env.PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
});
