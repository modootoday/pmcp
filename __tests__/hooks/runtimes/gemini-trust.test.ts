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

import { geminiTrust } from "../../../src/project/features/gemini-trust.js";

function home(t: TestContext, files: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-gemini-home-"));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, ".gemini"));
  for (const [name, value] of Object.entries(files))
    writeFileSync(join(dir, ".gemini", name), JSON.stringify(value));
  return dir;
}

function project(t: TestContext, command: string) {
  const root = mkdtempSync(join(tmpdir(), "pmcp-gemini-root-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".gemini"));
  const hook = { type: "command", name: "pmcp-before_tool", command };
  writeFileSync(
    join(root, ".gemini/settings.json"),
    JSON.stringify({ hooks: { BeforeTool: [{ hooks: [hook] }] } }),
  );
  return root;
}

describe("gemini trust is read, never written", () => {
  it("reports an unknown folder and new hooks when Gemini has no records", (t) => {
    const root = project(t, "node hook.mjs");
    const dir = home(t, {});
    expect(geminiTrust(root, dir)).toEqual({ folder: "unknown", hooks: "new" });
  });

  it("follows the most specific folder rule and the recorded hook identities", (t) => {
    const root = project(t, "node hook.mjs");
    const folders = { [join(root, "..")]: "TRUST_FOLDER" };
    const hooks = { [root]: ["pmcp-before_tool:node hook.mjs"] };
    const dir = home(t, {
      "trustedFolders.json": folders,
      "trusted_hooks.json": hooks,
    });
    expect(geminiTrust(root, dir)).toEqual({
      folder: "trusted",
      hooks: "reviewed",
    });
    writeFileSync(
      join(dir, ".gemini/trustedFolders.json"),
      JSON.stringify({ ...folders, [root]: "DO_NOT_TRUST" }),
    );
    const before = readFileSync(
      join(dir, ".gemini/trusted_hooks.json"),
      "utf8",
    );
    expect(geminiTrust(root, dir).folder).toBe("untrusted");
    expect(readFileSync(join(dir, ".gemini/trusted_hooks.json"), "utf8")).toBe(
      before,
    );
  });
});
