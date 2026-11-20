import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";

import { Ui } from "../../src/cli/ui.js";
import { dispatch } from "../../src/commands/index.js";
import { commit, isolateGit, remote, sh, type Remote } from "./fixture.js";

beforeAll(isolateGit);

function toml(origin: Remote, extra = ""): void {
  const state = join(origin.base, "state");
  writeFileSync(
    join(origin.main, "pmcp.toml"),
    `[sessions]\nstate_dir = "${state}"\n[git]\n[git.mainline.deliver]\nattempts = 1\n[git.mainline.sync]\n${extra}`,
  );
}

function quietUi(): { ui: Ui; out: string[] } {
  const out: string[] = [];
  const sink = { write: (text: string) => out.push(text) };
  return {
    ui: new Ui({ env: {}, quiet: true, stdout: sink, stderr: sink }),
    out,
  };
}

function textUi(): { ui: Ui; out: string[] } {
  const out: string[] = [];
  const sink = { write: (text: string) => out.push(text) };
  return {
    ui: new Ui({ env: {}, quiet: false, stdout: sink, stderr: sink }),
    out,
  };
}

interface DryRunResult {
  readonly ok: boolean;
  readonly code: number;
  readonly dryRun: boolean;
  readonly dry_run: boolean;
  readonly upstream: string;
  readonly commits: readonly {
    readonly sha: string;
    readonly short: string;
    readonly subject: string;
  }[];
  readonly count: number;
  readonly touched: readonly string[];
  readonly leases: readonly string[];
  readonly lockfile: boolean;
  readonly heavyGate: boolean;
  readonly heavy_gate: boolean;
}

async function runDryRunJson(
  cwd: string,
  extraArgs: string[] = [],
): Promise<{
  code: number;
  data: DryRunResult | null;
}> {
  const { ui, out } = quietUi();
  const code = await dispatch(
    ["git", "deliver", "--dry-run", "--json", ...extraArgs],
    { cwd, ui, env: process.env },
  );
  const line = out
    .join("")
    .split("\n")
    .find((text) => text.startsWith('{"schema"'));
  const envelope = line ? JSON.parse(line) : null;
  return { code, data: (envelope?.data ?? null) as DryRunResult | null };
}

it("--dry-run reports preview for code commit without lockfile or pushing", async () => {
  const origin = remote();
  toml(origin);
  const upstreamBefore = sh(origin.bare, "rev-parse", "main");
  const headSha = commit(
    origin.main,
    "feature.ts",
    "export const x = 1;\n",
    "feat: add feature",
  );

  const { code, data } = await runDryRunJson(origin.main);

  expect(code).toBe(0);
  expect(data).toMatchObject({
    ok: true,
    dryRun: true,
    dry_run: true,
    upstream: "origin/main",
    count: 1,
    lockfile: false,
    heavyGate: false,
    heavy_gate: false,
    leases: [],
  });
  expect(data?.commits).toHaveLength(1);
  expect(data?.commits[0]?.sha).toBe(headSha);
  expect(data?.commits[0]?.subject).toBe("feat: add feature");
  // Verify remote ref was untouched.
  expect(sh(origin.bare, "rev-parse", "main")).toBe(upstreamBefore);
});

it("--dry-run detects lockfile change and reports heavy gate requirement", async () => {
  const origin = remote();
  toml(origin, 'install_when_changed = ["bun.lock"]\n');
  const upstreamBefore = sh(origin.bare, "rev-parse", "main");
  const headSha = commit(
    origin.main,
    "bun.lock",
    "lockfile content\n",
    "chore: update lock",
  );

  const { code, data } = await runDryRunJson(origin.main);

  expect(code).toBe(0);
  expect(data).toMatchObject({
    ok: true,
    dryRun: true,
    dry_run: true,
    upstream: "origin/main",
    count: 1,
    lockfile: true,
    heavyGate: true,
    heavy_gate: true,
    leases: ["lockfile"],
  });
  expect(data?.commits[0]?.sha).toBe(headSha);
  expect(sh(origin.bare, "rev-parse", "main")).toBe(upstreamBefore);
});

it("--dry-run outputs text preview when not in json mode", async () => {
  const origin = remote();
  toml(origin);
  const upstreamBefore = sh(origin.bare, "rev-parse", "main");
  commit(origin.main, "test.txt", "content\n", "docs: update docs");

  const { ui, out } = textUi();
  const code = await dispatch(["git", "deliver", "--dry-run"], {
    cwd: origin.main,
    ui,
    env: process.env,
  });

  expect(code).toBe(0);
  const output = out.join("");
  expect(output).toContain("upstream: origin/main");
  expect(output).toContain("commits: 1");
  expect(output).toContain("docs: update docs");
  expect(output).toContain("lockfile: unchanged");
  expect(output).toContain("leases: none");
  expect(sh(origin.bare, "rev-parse", "main")).toBe(upstreamBefore);
});

it("--dry-run reports zero commits cleanly when branch is already up to date", async () => {
  const origin = remote();
  toml(origin);

  const { code, data } = await runDryRunJson(origin.main);

  expect(code).toBe(0);
  expect(data).toMatchObject({
    ok: true,
    dryRun: true,
    count: 0,
    commits: [],
    lockfile: false,
    heavyGate: false,
  });
});

it("git deliver --help documents the --dry-run option", async () => {
  const { ui, out } = textUi();
  const code = await dispatch(["git", "deliver", "--help"], {
    ui,
    env: process.env,
  });

  expect(code).toBe(0);
  const output = out.join("");
  expect(output).toContain("--dry-run");
});
