import { availableParallelism, homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { compileHooks } from "../../src/hooks/compile.js";
import { readLeaseSettings } from "../../src/lease/config.js";
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
      maxLoad: availableParallelism(),
      maxIo: 8,
      holdWarn: 1800,
      heartbeat: 60,
      poll: 15,
      profiles: {
        default: { maxWait: 3600, loadGrace: 900 },
        gate: { maxWait: 2700, loadGrace: 600 },
      },
      heavy: [],
      guard: "observe",
    });
  });

  it("reproduces a shell wrapper's limits and files from configuration", () => {
    const settings = read({
      dir: "~/.cache/datalab-host",
      marker_env: "PMCP_HEAVY_LEASE",
      legacy_marker_env: "DATALAB_HEAVY_LEASE",
      legacy_skip_env: "DATALAB_HEAVY_LEASE_SKIP",
      max_load: 8,
      max_io: 8,
      hold_warn: 1800,
      hold_max: 3600,
      memory_max: "6G",
      heavy: [["bun", "install"]],
      guard: "deny",
    });
    expect(settings).toMatchObject({
      dir: join(homedir(), ".cache/datalab-host"),
      legacyMarkerEnv: "DATALAB_HEAVY_LEASE",
      legacySkipEnv: "DATALAB_HEAVY_LEASE_SKIP",
      maxLoad: 8,
      maxIo: 8,
      holdMax: 3600,
      heavy: [["bun", "install"]],
      guard: "deny",
      profiles: {
        default: { maxWait: 3600, loadGrace: 900, memoryMax: "6G" },
        gate: { maxWait: 2700, loadGrace: 600, memoryMax: "6G" },
      },
    });
  });

  it("lets a profile override its limits and adds named profiles", () => {
    const settings = read({
      max_wait: 100,
      profiles: { gate: { max_wait: 50 }, nightly: { load_grace: 5 } },
    });
    expect(settings.profiles).toEqual({
      default: { maxWait: 100, loadGrace: 900 },
      gate: { maxWait: 50, loadGrace: 600 },
      nightly: { maxWait: 100, loadGrace: 5 },
    });
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
    expect(() => read({ marker_env: "lower" })).toThrow("environment variable");
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
    const compiled = compileHooks(
      { host: { lease: {} } },
      { root: "/p", tools: new Set() },
    );
    expect(compiled.policy).toBeNull();
  });
});
