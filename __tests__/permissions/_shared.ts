import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type TestContext } from "vitest";

import { readConfig } from "../../src/config.js";
import { project } from "../../src/project/apply.js";
import { readSpec } from "../../src/project/spec.js";

export const SETTINGS = ".claude/settings.json";
export const TEN = [
  "Read(.env)",
  "Read(.env.d/**)",
  "Read(**/.dev.vars)",
  "Read(**/.dev.vars.json)",
  "Read(**/*.bak.*)",
  "Bash(git push:*)",
  "Bash(git reset --hard:*)",
  "Bash(git checkout --:*)",
  "Bash(git clean:*)",
  "Bash(git stash:*)",
];

export const list = (values: readonly string[]) =>
  `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
export const claudeOnly = '[targets]\ntools = ["claude"]\n';

export function fixture(t: TestContext, toml: string, settings?: unknown) {
  const root = mkdtempSync(join(tmpdir(), "pmcp-permissions-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const config = join(root, "pmcp.toml");
  writeFileSync(config, toml);
  if (settings !== undefined) {
    mkdirSync(join(root, ".claude"));
    writeFileSync(join(root, SETTINGS), JSON.stringify(settings, null, 2));
  }
  const run = (check: boolean) => {
    const result = project(readSpec(readConfig(config)), { check });
    if (result.backup)
      t.onTestFinished(() =>
        rmSync(result.backup!, { recursive: true, force: true }),
      );
    return result;
  };
  return {
    root,
    config,
    apply: () => run(false),
    check: () => run(true),
    settings: () => JSON.parse(readFileSync(join(root, SETTINGS), "utf8")),
    text: () => readFileSync(join(root, SETTINGS), "utf8"),
    lock: () => JSON.parse(readFileSync(join(root, "pmcp.lock"), "utf8")),
  };
}

export function rejects(t: TestContext, body: string, message: string) {
  const { config } = fixture(t, claudeOnly + body);
  expect(() => readSpec(readConfig(config))).toThrow(message);
}
