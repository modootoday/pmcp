import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { dockerPolicy } from "../src/harness/runtimes/docker-policy.js";
import { assertContainerMounts } from "../src/harness/adapters/docker/mounts.js";
import { assertContainerIsolation } from "../src/harness/adapters/docker/security.js";

const policy = {
  schemaVersion: 1,
  image: `sha256:${"a".repeat(64)}`,
  network: "none",
  workspaceAccess: "read-only",
  commands: { "codex-cli": ["/usr/local/bin/codex"] },
};

it("Docker isolation cannot weaken seccomp or share host authority", () => {
  const host = {
    ReadonlyRootfs: true,
    Privileged: false,
    NetworkMode: "none",
    CgroupnsMode: "private",
    CapDrop: ["ALL"],
    CapAdd: null,
    SecurityOpt: ["no-new-privileges"],
    RestartPolicy: { Name: "no" },
    PidMode: "",
    UTSMode: "",
    UsernsMode: "",
    CgroupParent: "",
    IpcMode: "private",
    Devices: [],
    DeviceRequests: null,
    AutoRemove: false,
    VolumesFrom: null,
    GroupAdd: null,
    Binds: null,
    PortBindings: {},
  };
  assertContainerIsolation(host, "none");
  const broadened = [
    { SecurityOpt: ["no-new-privileges", "seccomp=unconfined"] },
    { CgroupParent: "peer.slice" },
    { PidMode: "host" },
    { UTSMode: "host" },
    { UsernsMode: "host" },
    { GroupAdd: ["0"] },
    { Devices: [{}] },
    { PortBindings: { "80/tcp": [{}] } },
    { Privileged: true },
    { NetworkMode: "bridge" },
  ];
  for (const authority of broadened)
    assert.throws(() =>
      assertContainerIsolation({ ...host, ...authority }, "none"),
    );
});

it("Docker grants reject floating images and unqualified network authority", () => {
  assert.throws(
    () => dockerPolicy({ ...policy, image: "node:latest" }),
    /docker_image_requires_digest/,
  );
  assert.throws(
    () => dockerPolicy({ ...policy, network: "host" }),
    /docker_network_not_qualified/,
  );
  assert.throws(
    () => dockerPolicy({ ...policy, workspaceAccess: "automatic" }),
    /invalid_docker_workspace_access/,
  );
});

it("Docker runtime declarations reject unknown runtimes and noncanonical commands", () => {
  const invalid = [
    { unknown: ["/usr/local/bin/codex"] },
    { constructor: ["/usr/local/bin/codex"] },
    JSON.parse('{"__proto__":["/usr/local/bin/codex"]}'),
    { "codex-cli": ["codex"] },
    { "codex-cli": ["/usr/local/bin/../bin/codex"] },
    { "codex-cli": ["/usr/local/bin/codex", "\x1b"] },
  ];
  for (const commands of invalid)
    assert.throws(() => dockerPolicy({ ...policy, commands }));
});

it("Docker policy snapshots do not share mutable input command arrays", () => {
  const input = structuredClone(policy);
  const grant = dockerPolicy(input);
  input.commands["codex-cli"].push("--other");
  assert.deepEqual(grant.commands["codex-cli"], ["/usr/local/bin/codex"]);
});

it("Docker mounts reject writable escalation, recursive binds and broad profile access", () => {
  const directory = mkdtempSync(join(tmpdir(), "pmcp-docker-policy-unit-"));
  const nonce = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const state = join(directory, "containers", nonce, "profile");
  const project = join(directory, "project");
  mkdirSync(state, { recursive: true, mode: 0o700 });
  mkdirSync(project, { mode: 0o700 });
  const grant = dockerPolicy(policy);
  const actual = {
    Mounts: [
      {
        Type: "bind",
        Source: project,
        Destination: "/workspace",
        RW: false,
        Propagation: "rprivate",
      },
      {
        Type: "bind",
        Source: state,
        Destination: "/state",
        RW: true,
        Propagation: "rprivate",
      },
    ],
    HostConfig: {
      Mounts: [
        { BindOptions: { NonRecursive: true } },
        { BindOptions: { NonRecursive: true } },
      ],
    },
  };
  try {
    assertContainerMounts(actual, state, project, directory, nonce, grant);
    const writable = structuredClone(actual);
    writable.Mounts[0]!.RW = true;
    assert.throws(
      () =>
        assertContainerMounts(
          writable,
          state,
          project,
          directory,
          nonce,
          grant,
        ),
      /ungranted_container_mount/,
    );
    const duplicate = structuredClone(actual);
    duplicate.Mounts[0] = duplicate.Mounts[1]!;
    assert.throws(
      () =>
        assertContainerMounts(
          duplicate,
          state,
          project,
          directory,
          nonce,
          grant,
        ),
      /ungranted_container_mount/,
    );
    const recursive = structuredClone(actual);
    recursive.HostConfig.Mounts[0]!.BindOptions.NonRecursive = false;
    assert.throws(
      () =>
        assertContainerMounts(
          recursive,
          state,
          project,
          directory,
          nonce,
          grant,
        ),
      /recursive_container_mount_not_admitted/,
    );
    chmodSync(state, 0o755);
    assert.throws(
      () =>
        assertContainerMounts(actual, state, project, directory, nonce, grant),
      /unsafe_container_state_directory/,
    );
  } finally {
    rmSync(directory, { recursive: true });
  }
});
