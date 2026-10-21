import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, it, type TestContext } from "vitest";

import { detect } from "../../src/git/detect.js";
import { lockHash, stampFile } from "../../src/git/install.js";
import {
  deliver,
  type Delivery,
  type DeliverOptions,
} from "../../src/git/mainline/deliver.js";
import { deliveryEvents } from "../../src/git/mainline/delivery-events.js";
import type { GitSetup } from "../../src/git/setup.js";
import { commit, isolateGit, recorder, remote } from "./fixture.js";

beforeAll(isolateGit);

it("tells recordDelivery which leases a delivery took, and names its holder while the gate runs", () => {
  const origin = remote();
  commit(origin.main, "bun.lock", "lock v2\n", "bump the lockfile");
  const seen: Delivery[] = [];
  const holder = join(origin.base, "holder-during-gate");
  const options: DeliverOptions = {
    ctx: detect(origin.main)!,
    named: [],
    deliver: {
      attempts: 1,
      refuseDirectPush: true,
      duringPause: "refuse",
      leaseWaitSeconds: 1,
    },
    gate: {
      command: ["sh", "-c", `cp "$(dirname "$PWD")/holder.json" ${holder}`],
      lockWaitSeconds: 60,
    },
    tree: join(origin.base, "state/gate/tree"),
    links: [],
    leases: [{ name: "lockfile", paths: ["bun.lock"] }],
    store: {
      pause: { read: () => null },
      leases: { read: () => null, take: () => true, release: () => {} },
    },
    recordDelivery: (delivery) => seen.push(delivery),
    report: recorder(),
  };
  expect(deliver(options)).toBe(0);
  expect(seen).toHaveLength(1);
  expect(seen[0]!).toMatchObject({
    leases: ["lockfile"],
    subject: "bump the lockfile",
  });
  expect(seen[0]!.commit).toMatch(/^[0-9a-f]{10}$/u);
  const record = JSON.parse(readFileSync(holder, "utf8"));
  expect(record).toMatchObject({
    subject: "bump the lockfile",
    checkout: origin.main,
  });
  expect(Object.keys(record).sort()).toEqual([
    "checkout",
    "pid",
    "startedAt",
    "subject",
    "tip",
  ]);
});

function setup(
  t: TestContext,
  installed: boolean,
): { setup: GitSetup; events: string } {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-events-"));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const main = join(dir, "main");
  mkdirSync(main);
  writeFileSync(join(main, "bun.lock"), "lock v2\n");
  const state = join(dir, "state");
  const sync = {
    install: ["bun", "install"],
    installWhenChanged: ["bun.lock"],
  };
  if (installed) {
    const stamp = stampFile(main, {
      command: sync.install,
      when: sync.installWhenChanged,
      stateDir: state,
    });
    mkdirSync(join(stamp, ".."), { recursive: true });
    writeFileSync(stamp, `${lockHash(main, ["bun.lock"])}\n`);
  }
  const events = join(dir, "gate/lockfile-events.jsonl");
  return {
    events,
    setup: {
      config: { leases: [{ name: "lockfile", paths: ["bun.lock"] }], sync },
      ctx: { mainRoot: main },
      stateDir: state,
      gateTree: join(dir, "gate/tree"),
      leaseFiles: { lockfile: { events } },
    } as unknown as GitSetup,
  };
}

it("appends one delivery event per changed lease, with the installed state of the main checkout", (t) => {
  const done = setup(t, true);
  deliveryEvents(done.setup)({
    leases: ["lockfile"],
    subject: "bump",
    commit: "abcdef0123",
  });
  const pending = setup(t, false);
  deliveryEvents(pending.setup)({
    leases: ["lockfile"],
    subject: "bump",
    commit: "abcdef0123",
  });
  const line = JSON.parse(readFileSync(done.events, "utf8").trim());
  expect(Object.keys(line).sort()).toEqual([
    "at",
    "commit",
    "hash",
    "installed",
    "lease",
    "subject",
  ]);
  expect(line).toMatchObject({
    subject: "bump",
    commit: "abcdef0123",
    installed: true,
    lease: "lockfile",
  });
  expect(line.hash).toMatch(/^[0-9a-f]{64}$/u);
  expect(
    JSON.parse(readFileSync(pending.events, "utf8").trim()).installed,
  ).toBe(false);
});
