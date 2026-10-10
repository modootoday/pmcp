import assert from "node:assert/strict";
import { it } from "vitest";
import { configurationDigest } from "../src/harness/adapters/docker/claims.js";
import { resourceAbsent } from "../src/harness/adapters/docker/observation.js";

const configuration = {
  Config: { User: "1000:1000", Env: ["HOME=/state", "TERM=xterm"] },
  HostConfig: { Memory: 134217728, CpuQuota: 25000, OomKillDisable: false },
  Mounts: [
    { Destination: "/state", RW: true, Source: "/owned/state" },
    { Destination: "/work", RW: false, Source: "/owned/fixture" },
  ],
};

it("container configuration digest preserves equivalent Docker inspection forms", () => {
  const equivalent = {
    Mounts: [...configuration.Mounts].reverse(),
    HostConfig: { OomKillDisable: null, CpuQuota: 25000, Memory: 134217728 },
    Config: { Env: ["HOME=/state", "TERM=xterm"], User: "1000:1000" },
  };
  assert.equal(
    configurationDigest(configuration),
    configurationDigest(equivalent),
  );
});

it("container configuration digest detects authority and budget changes", () => {
  const digest = configurationDigest(configuration);
  const changes = [
    {
      ...configuration,
      HostConfig: { ...configuration.HostConfig, CpuQuota: 50000 },
    },
    { ...configuration, Config: { ...configuration.Config, User: "0:0" } },
    {
      ...configuration,
      Mounts: [{ ...configuration.Mounts[0], Source: "/foreign/state" }],
    },
    {
      ...configuration,
      Config: {
        ...configuration.Config,
        Env: [...configuration.Config.Env].reverse(),
      },
    },
  ];
  for (const changed of changes)
    assert.notEqual(configurationDigest(changed), digest);
});

it("container configuration cannot disable the kernel OOM guard", () => {
  assert.throws(
    () =>
      configurationDigest({
        ...configuration,
        HostConfig: { ...configuration.HostConfig, OomKillDisable: true },
      }),
    /container_oom_protection_disabled/,
  );
});

it("container absence cannot mask a daemon failure or another resource", () => {
  const id = "a".repeat(64);
  assert.equal(
    resourceAbsent({ stderr: `error: no such object: ${id}\n` }, id),
    true,
  );
  assert.equal(
    resourceAbsent({ stderr: `Error: No such container: ${id}\n` }, id),
    true,
  );
  assert.equal(
    resourceAbsent(
      { stderr: `error: no such object: ${"b".repeat(64)}\n` },
      id,
    ),
    false,
  );
  assert.equal(
    resourceAbsent({ stderr: "Cannot connect to the Docker daemon" }, id),
    false,
  );
});
