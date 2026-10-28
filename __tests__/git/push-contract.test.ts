import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { readGitConfig } from "../../src/git/config.js";
import { detect } from "../../src/git/detect.js";
import {
  deliver,
  type DeliverOptions,
  type DeliverReceipt,
} from "../../src/git/mainline/deliver.js";
import type { DeliverConfig } from "../../src/git/types.js";
import type { ProjectConfig } from "../../src/config.js";
import {
  commit,
  isolateGit,
  recorder,
  remote,
  sh,
  type Remote,
} from "./fixture.js";

beforeAll(isolateGit);

// A pre-push hook outside the tree that records its environment and exits with `exit`.
function hook(origin: Remote, exit = 0): string {
  const dir = join(origin.base, "hooks");
  mkdirSync(dir, { recursive: true });
  const seen = join(origin.base, "hook-env");
  writeFileSync(
    join(dir, "pre-push"),
    `#!/bin/sh\necho "lock=$LOCK_HELD gated=$X_GATED deliver=$PMCP_GIT_DELIVER" >> "${seen}"\necho "hook ran"\nexit ${exit}\n`,
  );
  chmodSync(join(dir, "pre-push"), 0o755);
  sh(origin.main, "config", "core.hooksPath", dir);
  return seen;
}

function run(
  origin: Remote,
  deliverConfig: Partial<DeliverConfig>,
  command?: string[],
) {
  const receipts: DeliverReceipt[] = [];
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
      ...deliverConfig,
    },
    gate: {
      ...(command ? { command } : {}),
      lockWaitSeconds: 60,
      lockEnv: "LOCK_HELD",
    },
    tree: join(origin.base, "state/gate/tree"),
    links: [],
    leases: [],
    store: {
      pause: { read: () => null },
      leases: { read: () => null, take: () => true, release: () => {} },
    },
    onReceipt: (receipt) => receipts.push(receipt),
    report,
  };
  const code = deliver(options);
  return { code, receipt: receipts[0]!, lines: report.lines };
}

describe("the push of a delivery", () => {
  it("in command mode carries push_env and the marker, but not the lock variable", () => {
    const origin = remote();
    const seen = hook(origin);
    commit(origin.main, "a.txt", "a\n", "add a");
    const { code, receipt } = run(origin, { pushEnv: { X_GATED: "1" } }, [
      "true",
    ]);
    expect(code).toBe(0);
    expect(receipt.gate).toMatchObject({ exit: 0, by: "command" });
    expect(readFileSync(seen, "utf8")).toBe("lock= gated=1 deliver=1\n");
  });

  it("in pre-push mode runs no command, carries the lock variable and logs the hook as the gate", () => {
    const origin = remote();
    const seen = hook(origin);
    commit(origin.main, "a.txt", "a\n", "add a");
    const { code, receipt, lines } = run(origin, { gate: "pre-push" });
    expect(code).toBe(0);
    expect(readFileSync(seen, "utf8")).toBe("lock=1 gated= deliver=1\n");
    expect(receipt.gate).toMatchObject({ exit: 0, by: "pre-push" });
    expect(readFileSync(receipt.gate!.log!, "utf8")).toContain("hook ran");
    expect(lines.some((line) => line.includes("the pre-push hook gates"))).toBe(
      true,
    );
    expect(receipt.delivered).toBe(sh(origin.bare, "rev-parse", "main"));
  });

  it("in pre-push mode reports a refusing hook as a failed gate and pushes nothing", () => {
    const origin = remote();
    hook(origin, 1);
    const before = sh(origin.bare, "rev-parse", "main");
    commit(origin.main, "a.txt", "a\n", "add a");
    const { code, receipt } = run(origin, { gate: "pre-push" });
    expect(code).toBe(1);
    expect(receipt.gate).toMatchObject({ exit: 1, by: "pre-push" });
    expect(receipt.reason).toMatch(/^the pre-push gate failed \(exit 1\)/u);
    expect(sh(origin.bare, "rev-parse", "main")).toBe(before);
    expect(existsSync(receipt.gate!.log!)).toBe(true);
  });

  it("in pre-push mode streams the hook's output while the hook still runs", () => {
    const origin = remote();
    const dir = join(origin.base, "hooks");
    // Beside the gate tree when no state dir is given; one directory per tip.
    const logs = join(origin.base, "state/gate/gate-logs");
    mkdirSync(dir, { recursive: true });
    // The hook fails unless its first line reached the gate log before it ended.
    writeFileSync(
      join(dir, "pre-push"),
      `#!/bin/sh\necho "early line"\nfor i in 1 2 3 4 5 6 7 8 9 10; do\n  cat "${logs}"/*/*.log 2>/dev/null | grep -q "early line" && exit 0\n  sleep 0.2\ndone\nexit 9\n`,
    );
    chmodSync(join(dir, "pre-push"), 0o755);
    sh(origin.main, "config", "core.hooksPath", dir);
    commit(origin.main, "a.txt", "a\n", "add a");
    const { code, receipt } = run(origin, { gate: "pre-push" });
    expect(receipt.gate).toMatchObject({ exit: 0, by: "pre-push" });
    expect(code).toBe(0);
    expect(readFileSync(receipt.gate!.log!, "utf8")).toContain("early line");
  });
});

describe("[git.mainline.deliver] gate and push_env", () => {
  const read = (git: Record<string, unknown>) =>
    readGitConfig({
      path: "pmcp.toml",
      dir: "/repo",
      raw: { git },
    } as unknown as ProjectConfig);

  it("defaults to the command gate and an empty push environment", () => {
    expect(read({ mainline: { deliver: {} } })?.deliver).toMatchObject({
      gate: "command",
      pushEnv: {},
    });
  });

  it("refuses a gate command together with the pre-push gate", () => {
    expect(() =>
      read({
        mainline: {
          gate: { command: ["npm", "test"] },
          deliver: { gate: "pre-push" },
        },
      }),
    ).toThrow('gate = "pre-push" leaves gating to the pre-push hook');
  });

  it("takes only variable names and string values in push_env", () => {
    expect(() =>
      read({ mainline: { deliver: { push_env: { "bad-name": "1" } } } }),
    ).toThrow("push_env must be a table of variable names");
    expect(() =>
      read({ mainline: { deliver: { push_env: { CI_GATED: 1 } } } }),
    ).toThrow("push_env must be a table of variable names");
    expect(() => read({ mainline: { deliver: { gate: "hook" } } })).toThrow(
      "gate must be command | pre-push",
    );
  });
});
