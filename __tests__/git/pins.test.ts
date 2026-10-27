import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";

import { submodules as readSubmodules } from "../../src/git/config/tables.js";
import { detect } from "../../src/git/detect.js";
import {
  deliver,
  type DeliverOptions,
} from "../../src/git/mainline/deliver.js";
import {
  clone,
  commit,
  isolateGit,
  recorder,
  remote,
  sh,
  type Remote,
} from "./fixture.js";

beforeAll(isolateGit);

// A parent repository whose main checkout pins a submodule; lib is its origin.
function withLib(): { origin: Remote; lib: Remote } {
  const origin = remote();
  const lib = remote();
  const seed = clone(origin, "seed-parent");
  sh(seed, "submodule", "add", "-q", lib.bare, "lib");
  sh(seed, "commit", "-q", "-m", "add lib");
  sh(seed, "push", "-q", "origin", "HEAD:main");
  sh(origin.main, "pull", "-q", "--ff-only");
  sh(origin.main, "submodule", "update", "--init", "-q");
  return { origin, lib };
}

// A new lib commit pinned by a parent commit in the main checkout, not yet delivered.
function pinNew(origin: Remote, text: string): string {
  const dir = join(origin.main, "lib");
  sh(dir, "checkout", "-q", "-B", "main", "origin/main");
  const pin = commit(dir, "lib.txt", text, `lib ${text.trim()}`);
  sh(origin.main, "add", "lib");
  sh(origin.main, "commit", "-q", "-m", "bump lib");
  return pin;
}

function run(origin: Remote) {
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
    tree: join(origin.base, "state/gate/tree"),
    links: [],
    leases: [],
    store: {
      pause: { read: () => null },
      leases: { read: () => null, take: () => true, release: () => {} },
    },
    pushPins: true,
    report,
  };
  return { code: deliver(options), lines: report.lines };
}

it("needs no push when the pin is already on the submodule's origin", () => {
  const { origin, lib } = withLib();
  const pin = pinNew(origin, "v2\n");
  sh(join(origin.main, "lib"), "push", "-q", "origin", "HEAD:main");
  const { code, lines } = run(origin);
  expect(code).toBe(0);
  expect(lines).toContain(`lib: ${pin.slice(0, 10)} is already on its origin`);
  expect(sh(lib.bare, "rev-parse", "main")).toBe(pin);
});

it("pushes exactly the pinned commit, never a later one", () => {
  const { origin, lib } = withLib();
  const pin = pinNew(origin, "v2\n");
  commit(join(origin.main, "lib"), "lib.txt", "v3\n", "lib v3, not pinned");
  const { code, lines } = run(origin);
  expect(code).toBe(0);
  expect(sh(lib.bare, "rev-parse", "main")).toBe(pin);
  expect(lines).toContain(`lib: pushed ${pin.slice(0, 10)} to origin/main`);
  expect(sh(origin.bare, "log", "-1", "--format=%s", "main")).toBe("bump lib");
});

it("refuses, pushing nothing, when the submodule's origin moved past the pin's base", () => {
  const { origin, lib } = withLib();
  const before = sh(origin.bare, "rev-parse", "main");
  pinNew(origin, "v2\n");
  const other = clone(lib, "other-lib");
  commit(other, "elsewhere.txt", "x\n", "someone else");
  sh(other, "push", "-q", "origin", "HEAD:main");
  const moved = sh(lib.bare, "rev-parse", "main");
  const { code, lines } = run(origin);
  expect(code).toBe(1);
  expect(
    lines.some((line) => line.startsWith("lib: origin/main moved past")),
  ).toBe(true);
  expect(sh(lib.bare, "rev-parse", "main")).toBe(moved);
  expect(sh(origin.bare, "rev-parse", "main")).toBe(before);
});

it("reads push as pins or off", () => {
  expect(readSubmodules("pmcp.toml", { push: "pins" }).push).toBe("pins");
  expect(readSubmodules("pmcp.toml", {}).push).toBe("off");
  expect(() => readSubmodules("pmcp.toml", { push: "all" })).toThrow();
});
