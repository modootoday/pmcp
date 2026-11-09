import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { applyIo, ioDelegated } from "../../src/lease/iocontrol.js";
import { scoped } from "../../src/lease/scope.js";
import { settings } from "./fixture.js";

// A fake cgroup v2 tree: the user manager offers io, the slices above the scope do not
// enable it yet, and the scope gets io only once they do.
const MANAGER = "user.slice/user-1000.slice/user@1000.service";
const SCOPE = `/${MANAGER}/app.slice/pmcp-heavy-1.scope`;

function tree(managerControllers: string): string {
  const root = mkdtempSync(join(tmpdir(), "pmcp-cgroup-"));
  const dirs = [
    "user.slice",
    "user.slice/user-1000.slice",
    MANAGER,
    `${MANAGER}/app.slice`,
    `${MANAGER}/app.slice/pmcp-heavy-1.scope`,
  ];
  for (const dir of dirs) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, "cgroup.subtree_control"), "memory pids\n");
    writeFileSync(join(root, dir, "cgroup.controllers"), "memory pids\n");
  }
  writeFileSync(join(root, MANAGER, "cgroup.controllers"), managerControllers);
  return root;
}

describe("io control", () => {
  it("finds io delegated only when the user manager's cgroup offers it", () => {
    const self = `/${MANAGER}/app.slice/shell.scope`;
    expect(ioDelegated({ root: tree("cpu io memory\n"), self })).toBe(true);
    expect(ioDelegated({ root: tree("cpu memory\n"), self })).toBe(false);
    expect(ioDelegated({ root: tree("io\n"), self: "/init.scope" })).toBe(
      false,
    );
  });

  it("enables io down the scope's parents and sets the lane's weight and io.max", () => {
    const root = tree("cpu io memory\n");
    const scope = join(root, SCOPE);
    // The fake kernel: io reaches the scope once its parent enables it.
    expect(applyIo({ root, self: "" }, SCOPE, 25, "8:0 wbps=1000")).toEqual({
      weight: false,
      max: "failed",
    });
    const parent = join(root, MANAGER, "app.slice");
    expect(readFileSync(join(parent, "cgroup.subtree_control"), "utf8")).toBe(
      "+io",
    );
    writeFileSync(join(scope, "cgroup.controllers"), "io memory pids\n");
    expect(applyIo({ root, self: "" }, SCOPE, 25, "8:0 wbps=1000")).toEqual({
      weight: true,
      max: "set",
    });
    expect(readFileSync(join(scope, "io.weight"), "utf8")).toBe("default 25");
    expect(readFileSync(join(scope, "io.max"), "utf8")).toBe("8:0 wbps=1000");
  });

  it("wraps a job in a scope only when io or memory control applies", () => {
    const lease = settings("/x");
    const off = { root: tree("cpu memory\n"), self: `/${MANAGER}/a.scope` };
    expect(
      scoped(
        ["make"],
        lease,
        "bulk",
        undefined,
        () => {},
        () => {},
        off,
      ),
    ).toEqual({ argv: ["make"] });
    const disabled = settings("/x", { io: { enabled: false } });
    const on = { root: tree("io\n"), self: `/${MANAGER}/a.scope` };
    expect(
      scoped(
        ["make"],
        disabled,
        "bulk",
        undefined,
        () => {},
        () => {},
        on,
      ),
    ).toEqual({ argv: ["make"] });
    expect(
      scoped(
        ["make"],
        lease,
        null,
        undefined,
        () => {},
        () => {},
        on,
      ),
    ).toEqual({ argv: ["make"] });
  });

  it("reads io weights and io.max lines per lane", () => {
    const lease = settings("/x", {
      io: { weights: { bulk: 10 }, max: { bulk: "259:0 wbps=50000000" } },
    });
    expect(lease.io).toEqual({
      enabled: "auto",
      weights: { gate: 500, hook: 300, interactive: 100, bulk: 10 },
      max: { bulk: "259:0 wbps=50000000" },
    });
    expect(() => settings("/x", { io: { max: { bulk: "fast" } } })).toThrow(
      "io.max line",
    );
  });
});
