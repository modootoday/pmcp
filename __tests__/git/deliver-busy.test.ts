import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";

import { detect } from "../../src/git/detect.js";
import {
  deliver,
  type DeliverOptions,
} from "../../src/git/mainline/deliver.js";
import {
  commit,
  isolateGit,
  recorder,
  remote,
  sh,
  type Remote,
} from "./fixture.js";

beforeAll(isolateGit);
// Only deliver's own marker is under test, not one the runner inherited.
beforeAll(() => {
  delete process.env["PMCP_HEAVY_LEASE"];
});

// Deliver never takes the host lease; a gate's test stage does, through pmcp heavy, and a
// stage that never got it exits 75, which deliver reports as a busy host, nothing pushed.
function run(origin: Remote, gate: string) {
  const report = recorder();
  const options: DeliverOptions = {
    ctx: detect(origin.main)!,
    named: [],
    deliver: {
      attempts: 1,
      refuseDirectPush: true,
      duringPause: "refuse",
      gate: "command",
      pushEnv: {},
      leaseWaitSeconds: 1,
    },
    gate: { command: ["sh", "-c", gate], lockWaitSeconds: 60 },
    tree: join(origin.base, "state/gate/tree"),
    links: [],
    leases: [],
    store: {
      pause: { read: () => null },
      leases: { read: () => null, take: () => true, release: () => {} },
    },
    report,
  };
  return { report, code: deliver(options) };
}

it("reports a gate whose test stage could not get the host lease as exit 75, nothing pushed", () => {
  const origin = remote();
  const tip = commit(origin.main, "a.txt", "a\n", "add a");
  const { report, code } = run(origin, "exit 75");
  expect(code).toBe(75);
  expect(report.lines).toContain(
    "gate not run: host busy, nothing pushed, retry later",
  );
  expect(tip).not.toBe("");
  expect(sh(origin.bare, "log", "-1", "--format=%s", "main")).toBe("seed");
});

it("gates and pushes without any host lease of its own", () => {
  const origin = remote();
  const tip = commit(origin.main, "a.txt", "a\n", "add a");
  const marker = join(origin.base, "lease-marker");
  const { code } = run(
    origin,
    `test -z "$PMCP_HEAVY_LEASE" && touch ${marker}`,
  );
  expect(code).toBe(0);
  expect(existsSync(marker)).toBe(true);
  // Delivery replays the commit, so the pushed one is a copy: same subject and tree.
  expect(sh(origin.bare, "log", "-1", "--format=%s %T", "main")).toBe(
    sh(origin.main, "log", "-1", "--format=%s %T", tip),
  );
});
