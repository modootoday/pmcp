import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { project } from "../../src/project/apply.js";
import { readConfig } from "../../src/config.js";
import { readSpec } from "../../src/project/spec.js";
import { createFilesStore } from "../../src/sessions/files-store.js";
import { fixture } from "./helpers.js";

it("reports projection drift with the same problems as project check without writing", async (t) => {
  const { root, run } = fixture(
    t,
    '[targets]\ntools = ["claude"]\n[hooks.guards.git.stage_all]\nmode = "deny"\n',
  );
  const before = readFileSync(join(root, "pmcp.toml"), "utf8");
  const checked = project(readSpec(readConfig(join(root, "pmcp.toml"))), {
    check: true,
  });
  const result = await run("status", "--json");
  expect(result.code).toBe(2);
  expect(JSON.parse(result.out).projection.problems).toEqual(checked.problems);
  expect(readFileSync(join(root, "pmcp.toml"), "utf8")).toBe(before);
});

it("reports live state and unseen broadcasts without acknowledging them", async (t) => {
  const { root, run } = fixture(
    t,
    '[sessions]\nstate_dir = ".state"\n[sessions.registry]\n[sessions.leases.lockfile]\nblocks = [["bun", "install"]]\n',
  );
  const store = createFilesStore(join(root, ".state"));
  store.registry.upsert("reader-live", { pid: process.pid, status: "idle" });
  store.pause.write({ by: "operator", reason: "freeze" });
  store.leases.take("lockfile", { subject: "dependencies" });
  store.broadcast.post({ by: "operator", text: "notice" });
  const result = await run("sessions", "status", "--json");
  expect(result.code).toBe(0);
  const state = JSON.parse(result.out);
  expect(state.version).toBe(1);
  expect(state.live).toHaveLength(1);
  expect(state.pause.reason).toBe("freeze");
  expect(state.leases[0].name).toBe("lockfile");
  expect(state.broadcasts[0].unseenBy).toContain("reader-live");
  expect(store.registry.get("reader-live")?.seenBroadcast).toBeUndefined();
});

it("returns logs as a versioned JSON snapshot and tolerates a missing explicit file", async (t) => {
  const { root, run } = fixture(
    t,
    '[hooks]\nerror_log = ".state/errors.jsonl"\n',
  );
  expect(JSON.parse((await run("logs", "--json")).out).records).toEqual([]);
  mkdirSync(join(root, ".state"), { recursive: true });
  writeFileSync(
    join(root, ".state/errors.jsonl"),
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      msg: "problem",
    }) + "\n",
  );
  const result = await run("logs", "--json", "--since", "1h");
  expect(result.code).toBe(0);
  expect(JSON.parse(result.out).records[0].msg).toBe("problem");
});
