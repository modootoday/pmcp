import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";

import { Ui } from "../../src/cli/ui.js";
import { dispatch } from "../../src/commands/index.js";
import type { DeliverReceipt } from "../../src/git/mainline/deliver.js";
import { commit, isolateGit, remote, sh, type Remote } from "./fixture.js";

beforeAll(isolateGit);

function toml(origin: Remote, gate: string, deliver = ""): void {
  const state = join(origin.base, "state");
  writeFileSync(
    join(origin.main, "pmcp.toml"),
    `[sessions]\nstate_dir = "${state}"\n[sessions.leases.data]\npath = "a.txt"\n[git]\n[git.mainline.gate]\n${gate}[git.mainline.deliver]\nattempts = 1\n${deliver}[git.mainline.sync]\n`,
  );
}

async function noPush(cwd: string) {
  const out: string[] = [];
  const sink = { write: (text: string) => out.push(text) };
  const ui = new Ui({ env: {}, quiet: true, stdout: sink, stderr: sink });
  const code = await dispatch(["git", "deliver", "--no-push", "--json"], {
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

it("--no-push replays and gates, then moves nothing and takes no lease", async () => {
  const origin = remote();
  const marker = join(origin.base, "gated");
  toml(origin, `command = ["sh", "-c", "echo ran > ${marker}"]\n`);
  const upstream = sh(origin.bare, "rev-parse", "main");
  const head = commit(origin.main, "a.txt", "a\n", "add a");
  const { code, receipt } = await noPush(origin.main);
  expect(code).toBe(0);
  expect(existsSync(marker)).toBe(true);
  expect(receipt).toMatchObject({
    ok: true,
    delivered: null,
    leases: [],
    sync: null,
    gate: { exit: 0, by: "command" },
  });
  expect(sh(origin.main, "log", "-1", "--format=%s", receipt.replayed!)).toBe(
    "add a",
  );
  expect(sh(origin.bare, "rev-parse", "main")).toBe(upstream);
  expect(sh(origin.main, "rev-parse", "HEAD")).toBe(head);
});

it("--no-push reports a failing gate", async () => {
  const origin = remote();
  toml(origin, 'command = ["false"]\n');
  commit(origin.main, "a.txt", "a\n", "add a");
  const { code, receipt } = await noPush(origin.main);
  expect(code).toBe(1);
  expect(receipt.gate).toMatchObject({ exit: 1, by: "command" });
});

it("--no-push refuses the pre-push gate before anything runs", async () => {
  const origin = remote();
  toml(origin, "", 'gate = "pre-push"\n');
  commit(origin.main, "a.txt", "a\n", "add a");
  const { code, receipt } = await noPush(origin.main);
  expect(code).toBe(2);
  expect(receipt).toMatchObject({ attempts: 0, replayed: null, gate: null });
  expect(receipt.reason).toMatch(/^--no-push cannot gate/u);
});
