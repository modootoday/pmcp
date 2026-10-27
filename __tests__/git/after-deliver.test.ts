import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { Ui } from "../../src/cli/ui.js";
import { dispatch } from "../../src/commands/index.js";
import { readGitConfig } from "../../src/git/config.js";
import type { DeliverReceipt } from "../../src/git/mainline/deliver.js";
import type { ProjectConfig } from "../../src/config.js";
import { commit, isolateGit, remote, sh, type Remote } from "./fixture.js";

beforeAll(isolateGit);

function toml(origin: Remote, dirs: readonly string[], sync: string): void {
  const state = join(origin.base, "state");
  const body = `[sessions]\nstate_dir = "${state}"\n[git]\n[git.mainline.deliver]\nattempts = 1\n[git.mainline.sync]\n${sync}`;
  for (const dir of dirs) writeFileSync(join(dir, "pmcp.toml"), body);
}

async function deliverJson(cwd: string) {
  const out: string[] = [];
  const sink = { write: (text: string) => out.push(text) };
  const ui = new Ui({ env: {}, quiet: true, stdout: sink, stderr: sink });
  const code = await dispatch(["git", "deliver", "--json"], {
    cwd,
    ui,
    env: process.env,
  });
  const line = out
    .join("")
    .split("\n")
    .find((text) => text.startsWith('{"ok"'));
  return { code, receipt: JSON.parse(line ?? "null") as DeliverReceipt };
}

// A linked worktree with one commit to deliver; the main checkout stays where it was.
function linked(origin: Remote): { dir: string; before: string } {
  const dir = join(origin.base, "topic");
  sh(origin.main, "worktree", "add", "-q", "-b", "topic", dir, "origin/main");
  commit(dir, "a.txt", "a\n", "add a");
  return { dir, before: sh(origin.main, "rev-parse", "HEAD") };
}

describe("the main checkout's sync after a delivery", () => {
  it("is in the receipt when the delivery ran in the main checkout", async () => {
    const origin = remote();
    toml(origin, [origin.main], "");
    const before = commit(origin.main, "a.txt", "a\n", "add a");
    const { code, receipt } = await deliverJson(origin.main);
    expect(code).toBe(0);
    const delivered = sh(origin.bare, "rev-parse", "main");
    expect(receipt.sync).toEqual({ from: before, to: delivered, code: 0 });
  });

  it("is skipped from a linked worktree by default", async () => {
    const origin = remote();
    const { dir, before } = linked(origin);
    toml(origin, [origin.main, dir], "");
    const { code, receipt } = await deliverJson(dir);
    expect(code).toBe(0);
    expect(receipt.sync).toBeNull();
    expect(sh(origin.main, "rev-parse", "HEAD")).toBe(before);
  });

  it('moves the main checkout from a linked worktree with after_deliver = "always"', async () => {
    const origin = remote();
    const { dir, before } = linked(origin);
    toml(origin, [origin.main, dir], 'after_deliver = "always"\n');
    writeFileSync(join(origin.main, "README.md"), "edited\n");
    const { code, receipt } = await deliverJson(dir);
    expect(code).toBe(0);
    const delivered = sh(origin.bare, "rev-parse", "main");
    expect(receipt.sync).toEqual({ from: before, to: delivered, code: 0 });
    expect(sh(origin.main, "rev-parse", "HEAD")).toBe(delivered);
    expect(sh(origin.main, "status", "--porcelain")).toContain("README.md");
  });

  it("keeps every refusal of the main checkout and still exits 0", async () => {
    const origin = remote();
    const { dir, before } = linked(origin);
    toml(origin, [origin.main, dir], 'after_deliver = "always"\n');
    sh(origin.main, "checkout", "-q", "-b", "elsewhere");
    const { code, receipt } = await deliverJson(dir);
    expect(code).toBe(0);
    expect(receipt.ok).toBe(true);
    expect(receipt.sync).toEqual({
      from: before,
      to: before,
      code: 2,
      reason: "the main checkout is on elsewhere, not main",
    });
    expect(sh(origin.main, "rev-parse", "HEAD")).toBe(before);
  });

  it('runs no sync with after_deliver = "off"', async () => {
    const origin = remote();
    toml(origin, [origin.main], 'after_deliver = "off"\n');
    const before = commit(origin.main, "a.txt", "a\n", "add a");
    const { code, receipt } = await deliverJson(origin.main);
    expect(code).toBe(0);
    expect(receipt.sync).toBeNull();
    expect(sh(origin.main, "rev-parse", "HEAD")).toBe(before);
  });

  it("takes only from_main, always or off", () => {
    const read = (sync: Record<string, unknown>) =>
      readGitConfig({
        path: "pmcp.toml",
        dir: "/repo",
        raw: { git: { mainline: { sync } } },
      } as unknown as ProjectConfig);
    expect(read({})?.sync?.afterDeliver).toBe("from_main");
    expect(() => read({ after_deliver: "main" })).toThrow(
      "after_deliver must be from_main | always | off",
    );
  });
});
