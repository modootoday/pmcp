import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it, type TestContext } from "vitest";

import { missingBinary } from "../src/native/binary.js";

// An install made while npm was still processing the platform package (0.18.4), or with
// --omit=optional, has only the main package; the message must lead to the reinstall.
function from(t: TestContext, layout: "none" | "empty"): string {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-native-"));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  if (layout === "empty") {
    const pkg = join(
      dir,
      "node_modules/@modootoday",
      `pmcp-${process.platform}-${process.arch}`,
    );
    mkdirSync(join(pkg, "bin"), { recursive: true });
    writeFileSync(join(pkg, "package.json"), "{}");
  }
  return pathToFileURL(join(dir, "cli.js")).href;
}

const platform = `${process.platform}-${process.arch}`;

it("names the platform package and the reinstall when it is not installed", (t) => {
  expect(
    missingBinary("pmcp-pty", "PMCP_PTY_BIN", "9.9.9", from(t, "none")),
  ).toBe(
    `pmcp-pty not found: the platform package @modootoday/pmcp-${platform}@9.9.9 is not installed; reinstall @modootoday/pmcp (npm installs it as an optional dependency), or set PMCP_PTY_BIN to a pmcp-pty you built`,
  );
});

it("says when the installed platform package lacks the binary", (t) => {
  expect(
    missingBinary("pmcp-tui", "PMCP_TUI_BIN", "9.9.9", from(t, "empty")),
  ).toBe(
    `pmcp-tui not found: @modootoday/pmcp-${platform} has no pmcp-tui; reinstall @modootoday/pmcp, or set PMCP_TUI_BIN to a pmcp-tui you built`,
  );
});

it("says when a binary is not built for this platform at all", (t) => {
  expect(missingBinary("pmcp-nothing", "X_BIN", "9.9.9", from(t, "none"))).toBe(
    `pmcp-nothing is not built for ${platform}; set X_BIN to a pmcp-nothing you built`,
  );
});
