import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { replaceFile } from "../src/project/write.js";

const failures = vi.hoisted(() => ({ rename: false }));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return {
    ...fs,
    renameSync: (...args: Parameters<typeof fs.renameSync>) => {
      if (failures.rename) throw new Error("fixture_rename_failed");
      return fs.renameSync(...args);
    },
  };
});

let directory: string | undefined;
afterEach(() => {
  failures.rename = false;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

it("preserves configuration bytes and permissions when replacement fails", () => {
  directory = mkdtempSync(join(tmpdir(), "pmcp-project-write-"));
  const file = join(directory, "config.json");
  writeFileSync(file, '{"personal":"preserved"}\n', { mode: 0o600 });
  failures.rename = true;
  expect(() => replaceFile(file, '{"personal":"changed"}\n')).toThrow(
    "fixture_rename_failed",
  );
  expect(readFileSync(file, "utf8")).toBe('{"personal":"preserved"}\n');
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(readdirSync(directory)).toEqual(["config.json"]);
});

it("retains private permissions across a complete configuration replacement", () => {
  directory = mkdtempSync(join(tmpdir(), "pmcp-project-write-"));
  const file = join(directory, "config.json");
  writeFileSync(file, "old", { mode: 0o600 });
  replaceFile(file, '{"personal":"preserved","managed":"new"}\n');
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
    personal: "preserved",
    managed: "new",
  });
  expect(statSync(file).mode & 0o777).toBe(0o600);
});
