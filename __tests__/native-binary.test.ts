import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { nativeBinary } from "../src/native/binary.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function bin(name: string): string {
  const directory = mkdtempSync(join(tmpdir(), "pmcp-native-"));
  directories.push(directory);
  const path = join(directory, name);
  writeFileSync(path, "#!/bin/sh\n");
  chmodSync(path, 0o755);
  return path;
}

// No platform package is installed in the repository, so these cover the override and PATH ends;
// the packaged middle is checked against packed tarballs in the release dry run.
it("prefers the override, and a broken override is not silently replaced", () => {
  const onPath = bin("pmcp-pty");
  const given = bin("pmcp-pty");
  const path = join(onPath, "..");
  expect(nativeBinary("pmcp-pty", "PMCP_PTY_BIN", { PATH: path })).toBe(onPath);
  expect(
    nativeBinary("pmcp-pty", "PMCP_PTY_BIN", {
      PATH: path,
      PMCP_PTY_BIN: given,
    }),
  ).toBe(given);
  expect(
    nativeBinary("pmcp-pty", "PMCP_PTY_BIN", {
      PATH: path,
      PMCP_PTY_BIN: join(path, "missing"),
    }),
  ).toBeNull();
  expect(nativeBinary("pmcp-tui", "PMCP_TUI_BIN", { PATH: path })).toBeNull();
});
