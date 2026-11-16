import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

import { detailFields } from "../../src/lease/log-records.js";
import { fixture } from "../cli-surface/helpers.js";

it("splits a lease detail at each key, so a label keeps its spaces", () => {
  expect(
    detailFields(
      "waited=3 cwd=/w label=bun install --frozen-lockfile lane=bulk weight=3",
    ),
  ).toEqual({
    waited: "3",
    cwd: "/w",
    label: "bun install --frozen-lockfile",
    lane: "bulk",
    weight: "3",
  });
});

it("reads the host lease's events and usage as log records only when the query names the lease", async (t) => {
  const { root, run } = fixture(t, "");
  const dir = join(root, "lease");
  writeFileSync(join(root, "pmcp.toml"), `[host.lease]\ndir = "${dir}"\n`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "heavy.log"),
    "2026-11-15T10:00:00Z\t41\tacquired\twaited=600 cwd=/w label=bun install lane=bulk weight=3\n" +
      "2026-11-15T10:00:09Z\t41\treleased\tran=9 rc=0\n" +
      "2026-11-15T10:01:00Z\t42\ttimeout\twaited=3600 label=gate lane=gate\n",
  );
  writeFileSync(
    join(dir, "usage.jsonl"),
    `${JSON.stringify({ at: "2026-11-15T10:00:09.500Z", signature: "bun install", wall_s: 9, outcome: "ran", exit: 0 })}\n`,
  );
  const records = async (...args: string[]) =>
    JSON.parse((await run("logs", "--json", ...args)).out).data.records;

  expect(await records()).toEqual([]);
  const lease = await records("--component", "lease");
  expect(lease.map((r: { msg: string }) => r.msg)).toEqual([
    "acquired",
    "released",
    "ran",
    "timeout",
  ]);
  expect(lease[0]).toMatchObject({
    level: "info",
    component: "lease",
    data: { pid: 41, label: "bun install", lane: "bulk", waited: "600" },
  });
  expect(lease[3].level).toBe("warn");
  expect(
    (await records("--component", "lease.usage")).map(
      (r: { data: { signature: string } }) => r.data.signature,
    ),
  ).toEqual(["bun install"]);
  expect(await records("--component", "lease", "--level", "warn")).toHaveLength(
    1,
  );
});
