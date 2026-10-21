import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { readConfig } from "../../src/config.js";
import { loadGit } from "../../src/git/setup.js";
import { projectStateDir } from "../../src/sessions/state-dir.js";
import { readSpec } from "../../src/project/spec.js";

// The hook resolves state through policy.json; the git CLI through its own reader. Both must agree.
function resolved(stateDir: string) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "pmcp-state-dir-")));
  const home = join(base, "home");
  const root = join(base, "repo");
  mkdirSync(home);
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  writeFileSync(
    join(root, "pmcp.toml"),
    `[sessions]\nstate_dir = ${JSON.stringify(stateDir)}\n\n[sessions.registry]\n\n[git]\n`,
  );
  vi.stubEnv("HOME", home);
  try {
    const spec = readSpec(readConfig(join(root, "pmcp.toml")));
    const hook = projectStateDir(root, spec.hookBundle?.policy?.stateDir);
    const git = loadGit(root, undefined, process.env);
    if (git instanceof Error) throw git;
    return { hook, git: git.stateDir, home, root };
  } finally {
    vi.unstubAllEnvs();
    rmSync(base, { recursive: true, force: true });
  }
}

describe("[sessions] state_dir", () => {
  it.each([
    ["~", (home: string) => home],
    ["~/state", (home: string) => join(home, "state")],
    ["$HOME/state", (home: string) => join(home, "state")],
    [".pmcp-state", (_: string, root: string) => join(root, ".pmcp-state")],
    ["/var/tmp/pmcp-state", () => "/var/tmp/pmcp-state"],
  ])(
    "resolves %s to the same directory for the hooks and the git CLI",
    (form, expected) => {
      const { hook, git, home, root } = resolved(form);
      expect(hook).toBe(expected(home, root));
      expect(git).toBe(hook);
    },
  );
});
