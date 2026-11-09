import { availableParallelism, homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { compileHooks } from "../../src/hooks/compile.js";
import { readLeaseSettings } from "../../src/lease/config.js";
import { laneFor } from "../../src/lease/run.js";
import { readHost } from "../../src/project/host-spec.js";

const read = (lease: unknown) =>
  readLeaseSettings(
    "pmcp.toml",
    "/project",
    lease === undefined ? {} : { lease },
  );

describe("[host.lease]", () => {
  it("defaults to an enabled lease sized to the host", () => {
    const settings = readLeaseSettings("pmcp.toml", "/project", undefined);
    expect(settings).toEqual({
      enabled: true,
      dir: join(homedir(), ".cache/pmcp/host"),
      markerEnv: "PMCP_HEAVY_LEASE",
      skipAlways: [],
      skipReasons: [],
      maxLoad: availableParallelism(),
      maxIo: 8,
      ioWindow: "avg60",
      jobLogBytes: 4194304,
      hardFactor: 2,
      holdWarn: 1800,
      heartbeat: 60,
      poll: 15,
      budget: 4,
      slots: { gate: 1, hook: 1, interactive: 2, bulk: 1 },
      weights: { gate: 1, hook: 1, interactive: 2, bulk: 3 },
      commands: [],
      tiny: [],
      perSession: 1,
      profiles: {
        default: { maxWait: 3600, loadGrace: 900 },
        gate: { maxWait: 2700, loadGrace: 600 },
        hook: { maxWait: 900, loadGrace: 30 },
      },
      heavy: [],
      guard: "observe",
      io: {
        enabled: "auto",
        weights: { gate: 500, hook: 300, interactive: 100, bulk: 25 },
        max: {},
      },
      usageCap: 5_000_000,
      settleWindow: 60,
    });
  });

  it("reproduces a shell wrapper's one-at-a-time lease from configuration", () => {
    const settings = read({
      dir: "~/.cache/wrapper-host",
      legacy_marker_env: "WRAPPER_HEAVY_LEASE",
      legacy_skip_env: "WRAPPER_HEAVY_LEASE_SKIP",
      max_load: 8,
      max_io: 8,
      io_window: "avg10",
      budget: 1,
      hold_max: 3600,
      memory_max: "6G",
      heavy: [["bun", "install"]],
      guard: "deny",
    });
    expect(settings).toMatchObject({
      dir: join(homedir(), ".cache/wrapper-host"),
      legacyMarkerEnv: "WRAPPER_HEAVY_LEASE",
      legacySkipEnv: "WRAPPER_HEAVY_LEASE_SKIP",
      maxLoad: 8,
      maxIo: 8,
      ioWindow: "avg10",
      budget: 1,
      holdMax: 3600,
      heavy: [["bun", "install"]],
      guard: "deny",
      profiles: {
        default: { maxWait: 3600, loadGrace: 900, memoryMax: "6G" },
        gate: { maxWait: 2700, loadGrace: 600, memoryMax: "6G" },
      },
    });
  });

  it("reads lanes, weights, commands and profiles", () => {
    const settings = read({
      max_wait: 100,
      load_grace: 0,
      lanes: { bulk: 2, gate: 0 },
      weights: { interactive: 3 },
      commands: [
        { argv: ["npm", "install"], lane: "bulk", weight: 3 },
        { argv: ["npm", "test"], weight: 2 },
      ],
      profiles: { gate: { max_wait: 50 }, nightly: { load_grace: 5 } },
    });
    expect(settings.slots).toEqual({
      gate: 0,
      hook: 1,
      interactive: 2,
      bulk: 2,
    });
    expect(settings.weights.interactive).toBe(3);
    expect(settings.profiles).toMatchObject({
      default: { maxWait: 100, loadGrace: 0 },
      gate: { maxWait: 50, loadGrace: 600 },
      nightly: { maxWait: 100, loadGrace: 5 },
    });
    const run = {
      settings,
      profile: "default",
      cwd: "/",
      env: {},
      say: () => {},
    };
    expect(laneFor({ ...run, argv: ["/usr/bin/npm", "install", "x"] })).toEqual(
      {
        lane: "bulk",
        weight: 3,
      },
    );
    expect(laneFor({ ...run, argv: ["npm", "test"] })).toEqual({
      lane: "interactive",
      weight: 2,
    });
    const tiny = { ...run, settings: read({ tiny: [["npm", "run", "lint"]] }) };
    expect(laneFor({ ...tiny, argv: ["npm", "run", "lint", "--fix"] })).toEqual(
      {
        lane: "interactive",
        weight: 0,
      },
    );
    expect(laneFor({ ...run, argv: ["make"] })).toEqual({
      lane: "interactive",
      weight: 3,
    });
    expect(
      laneFor({ ...run, profile: "gate", argv: ["npm", "test"], weight: 4 }),
    ).toEqual({ lane: "gate", weight: 4 });
  });

  it("reads skip reasons and the heavy preset", () => {
    const settings = read({
      skip_reasons: ["ci", "gate-light"],
      heavy: "default",
    });
    expect(settings.skipReasons).toEqual(["ci", "gate-light"]);
    expect(settings.heavy).toContainEqual(["bun", "install"]);
    expect(read({}).heavy).toEqual(settings.heavy);
    expect(read({ heavy: [] }).heavy).toEqual([]);
    expect(() => read({ skip_reasons: ["Whole Suite"] })).toThrow(
      "skip_reasons must be a list of skip reasons",
    );
    expect(() => read({ heavy: "all" })).toThrow('heavy must be "default"');
  });

  it("rejects unknown keys and malformed values", () => {
    expect(() => read({ max_wiat: 1 })).toThrow(
      "unknown key [host.lease] max_wiat",
    );
    expect(() => read({ heavy: ["bun install"] })).toThrow("argv prefixes");
    expect(() => read({ memory_max: "6GB" })).toThrow("memory_max");
    expect(() => read({ guard: "block" })).toThrow(
      "observe | warn | deny | off",
    );
    expect(() => read({ io_window: "avg5" })).toThrow("avg10 | avg60 | avg300");
    expect(() => read({ hard_factor: 0.5 })).toThrow("hard_factor");
    expect(() => read({ marker_env: "lower" })).toThrow("environment variable");
    expect(() => read({ lanes: { fast: 1 } })).toThrow(
      "unknown key [host.lease.lanes] fast",
    );
    expect(() => read({ weights: { bulk: 0 } })).toThrow("at least 1");
    expect(() => read({ commands: [{ argv: ["x"], lane: "fast" }] })).toThrow(
      "lane must be",
    );
    expect(() => read({ profiles: { gate: { wait: 1 } } })).toThrow(
      "unknown key [host.lease.profiles.gate] wait",
    );
  });

  it("does not declare a pmcp-pty host or its approval guard on its own", () => {
    const host = { lease: { heavy: [["bun", "install"]] } };
    expect(readHost("pmcp.toml", host)).toBeUndefined();
    expect(() => readHost("pmcp.toml", { lease: { bad: 1 } })).toThrow(
      "unknown key [host.lease] bad",
    );
    const tools = { root: "/p", tools: new Set<string>() };
    const off = compileHooks({ host: { lease: { heavy: [] } } }, tools);
    expect(off.policy).toBeNull();
    const preset = compileHooks({ host: { lease: {} } }, tools);
    expect(preset.policy?.guards.map((guard) => guard.id)).toEqual([
      "host.lease",
    ]);
  });
});
