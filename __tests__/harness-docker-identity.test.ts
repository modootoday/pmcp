import assert from "node:assert/strict";
import { it } from "vitest";
import {
  containerLabels,
  containerName,
} from "../src/harness/adapters/docker/identity.js";
import { assertResourceOwner } from "../src/harness/adapters/docker/claims.js";
import type { DockerResource } from "../src/harness/contracts.js";

const resource: DockerResource = {
  kind: "docker",
  id: "a".repeat(64),
  owner: "owner-id",
  nonce: "nonce-id",
  role: "worker",
  image: `sha256:${"b".repeat(64)}`,
  configurationDigest: "c".repeat(64),
  memoryMb: 64,
  cpuQuota: 10000,
};

it("owned resource identity uses the public harness namespace", () => {
  assert.equal(
    containerName("12345678-owner", "session"),
    "pmcp-harness-12345678-session",
  );
  assertResourceOwner(resource, {
    Id: resource.id,
    Image: resource.image,
    Config: {
      Labels: {
        [containerLabels.owner]: resource.owner,
        [containerLabels.nonce]: resource.nonce,
        [containerLabels.role]: resource.role,
      },
    },
  });
});

it("legacy pilot labels and mismatched public identity cannot grant ownership", () => {
  for (const labels of [
    {
      "pmcp.pilot.owner": resource.owner,
      "pmcp.pilot.nonce": resource.nonce,
      "pmcp.pilot.role": resource.role,
    },
    {
      [containerLabels.owner]: "peer",
      [containerLabels.nonce]: resource.nonce,
      [containerLabels.role]: resource.role,
    },
    {
      [containerLabels.owner]: resource.owner,
      [containerLabels.nonce]: "other",
      [containerLabels.role]: resource.role,
    },
  ]) {
    assert.throws(
      () =>
        assertResourceOwner(resource, {
          Id: resource.id,
          Image: resource.image,
          Config: { Labels: labels },
        }),
      /foreign_container_identity/,
    );
  }
});
