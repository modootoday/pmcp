import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import { grokTrust } from "../../../src/project/features/grok-trust.js";

function home(t: TestContext, toml?: string) {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-grok-home-"));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, ".grok"));
  if (toml !== undefined)
    writeFileSync(join(dir, ".grok/trusted_folders.toml"), toml);
  return dir;
}

describe("grok trust is read, never written", () => {
  it("is unknown without a trust file", (t) => {
    expect(grokTrust("/w/project", home(t))).toBe("unknown");
  });

  it("takes the most specific folder entry and leaves the file as it was", (t) => {
    const toml =
      '[folders."/w"]\ntrusted = true\ndecided_at = 1\n\n[folders."/w/project"]\ntrusted = false\ndecided_at = 2\n';
    const dir = home(t, toml);
    expect(grokTrust("/w/other", dir)).toBe("trusted");
    expect(grokTrust("/w/project/sub", dir)).toBe("untrusted");
    expect(grokTrust("/elsewhere", dir)).toBe("untrusted");
    expect(readFileSync(join(dir, ".grok/trusted_folders.toml"), "utf8")).toBe(
      toml,
    );
  });
});
