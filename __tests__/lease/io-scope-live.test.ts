import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

import { cgroupHost, ioDelegated } from "../../src/lease/iocontrol.js";
import { userManager } from "../../src/lease/scope.js";
import { leaseToml, pmcpSync, project, scratch } from "./fixture.js";

// Runs only where a user manager answers and io reaches it: the job reads its own scope's
// io.weight and io.max, which must be its lane's, not the kernel defaults.
const live =
  process.platform === "linux" &&
  ioDelegated(cgroupHost()) &&
  userManager().unreachable(process.env) === null;

function disk(): string | null {
  try {
    const name = readdirSync("/sys/block").find(
      (entry) => !/^(loop|ram|zram)/u.test(entry),
    );
    return name ? readFileSync(`/sys/block/${name}/dev`, "utf8").trim() : null;
  } catch {
    return null;
  }
}

it.skipIf(!live || disk() === null)(
  "runs a bulk job in a scope with the bulk lane's io.weight and io.max",
  () => {
    const { base, dir, env } = scratch();
    // An IOPS ceiling far above any device, so the test slows nothing down.
    const max = `${disk()} riops=1000000`;
    const cwd = project(
      base,
      leaseToml(
        dir,
        `[host.lease.io]\nenabled = true\n[host.lease.io.max]\nbulk = "${max}"\n`,
      ),
    );
    const read =
      'sleep 2; d="/sys/fs/cgroup$(sed -n "s/^0:://p" /proc/self/cgroup)"; cat "$d/io.weight" "$d/io.max"';
    const result = pmcpSync(
      ["heavy", "--lane", "bulk", "--", "sh", "-c", read],
      cwd,
      env,
    );
    expect(result.stderr).not.toContain("io control did not reach");
    expect(result.stderr).not.toContain("was refused");
    expect(result.status).toBe(0);
    const [weight, ...limits] = result.stdout.trim().split("\n");
    expect(weight).toBe("default 25");
    expect(limits.join("\n")).toContain(`${disk()} `);
    expect(limits.join("\n")).toContain("riops=1000000");
  },
  30_000,
);
