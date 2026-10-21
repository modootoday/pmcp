import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "vitest";
import { Ui } from "../../src/cli/ui.js";
import { dispatch } from "../../src/commands/index.js";

export function fixture(
  t: TestContext,
  source = '[targets]\ntools = ["claude", "codex"]\n',
) {
  const root = mkdtempSync(join(tmpdir(), "pmcp-cli-surface-"));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "pmcp.toml"), source);
  const run = async (...args: string[]) => {
    let out = "";
    let err = "";
    const ui = new Ui({
      stdout: { write: (text) => void (out += text) },
      stderr: { write: (text) => void (err += text) },
    });
    const code = await dispatch(args, {
      cwd: root,
      env: { XDG_STATE_HOME: join(root, ".xdg") },
      ui,
    });
    return { code, out, err };
  };
  return { root, run };
}
