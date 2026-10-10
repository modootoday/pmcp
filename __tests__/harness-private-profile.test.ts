import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { it } from "vitest";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  selectedProfile,
  privateProfiles,
} from "../src/harness/runtimes/private-profiles.js";
import {
  assertProfileAvailable,
  assertProfileIdentity,
  captureProfile,
} from "../src/harness/adapters/docker/private-profile.js";
import { containerEntrypoint } from "../src/harness/adapters/docker/entrypoint.js";
import type { DockerPolicy } from "../src/harness/contracts.js";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "pmcp-profile-unit-"));
  chmodSync(directory, 0o700);
  const project = join(directory, "project");
  const profile = join(directory, "profile");
  mkdirSync(project, { mode: 0o700 });
  mkdirSync(profile, { mode: 0o700 });
  const grant = {
    runtime: "codex-cli",
    directory: profile,
    lockExecutable: "/usr/bin/flock",
  };
  return { directory, project, profile, grant };
}

it("private profiles require distinct named canonical path grants", () => {
  const grant = {
    runtime: "codex-cli",
    directory: "/private/codex",
    lockExecutable: "/usr/bin/flock",
  };
  assert.deepEqual(privateProfiles({ main: grant }), { main: grant });
  for (const value of [
    {},
    { "../main": grant },
    { main: grant, worker: grant },
    { main: { ...grant, directory: "relative" } },
    { main: { ...grant, lockExecutable: "/bin/../flock" } },
    { main: { ...grant, identity: "pid:123" } },
  ])
    assert.throws(() => privateProfiles(value));
});

it("private profile selection and lock wrapping are explicit and runtime bound", () => {
  const policy: DockerPolicy = {
    schemaVersion: 1,
    image: `sha256:${"a".repeat(64)}`,
    network: "none",
    workspaceAccess: "read-only",
    commands: { "codex-cli": ["/bin/codex"] },
    privateProfiles: {
      main: {
        runtime: "codex-cli",
        directory: "/private/codex",
        lockExecutable: "/usr/bin/flock",
        identity: "1:2:1:3",
      },
    },
  };
  assert.equal(selectedProfile(policy, undefined, "codex-cli"), undefined);
  assert.throws(
    () => selectedProfile(policy, "unknown", "codex-cli"),
    /not_granted/,
  );
  assert.throws(
    () => selectedProfile(policy, "main", "grok-cli"),
    /not_granted/,
  );
  assert.deepEqual(containerEntrypoint(policy, "codex-cli", "12345678"), [
    "/bin/codex",
  ]);
  assert.deepEqual(
    containerEntrypoint(policy, "codex-cli", "12345678", "main"),
    [
      "/usr/bin/flock",
      "--exclusive",
      "--nonblock",
      "--close",
      "--conflict-exit-code",
      "73",
      "/state/profile.lock",
      "/bin/codex",
    ],
  );
});

it("private profile custody excludes workspace exposure and preserves credential bytes", () => {
  const t = fixture();
  const credential = join(t.profile, "opaque-native-auth");
  writeFileSync(credential, "fixture-opaque-bytes", { mode: 0o600 });
  try {
    assert.throws(
      () => captureProfile({ ...t.grant, directory: t.project }, t.project),
      /scope_not_admitted/,
    );
    const grant = captureProfile(t.grant, t.project);
    assertProfileIdentity(grant, t.project);
    assertProfileAvailable(grant, t.project);
    assert.equal(statSync(join(t.profile, "profile.lock")).mode & 0o777, 0o600);
    assert.equal(readFileSync(credential, "utf8"), "fixture-opaque-bytes");
    chmodSync(t.profile, 0o755);
    assert.throws(
      () => assertProfileIdentity(grant, t.project),
      /unsafe_private_profile/,
    );
  } finally {
    rmSync(t.directory, { recursive: true });
  }
});

it("lock replacement and symbolic profile paths cannot inherit a frozen grant", () => {
  const t = fixture();
  try {
    const grant = captureProfile(t.grant, t.project);
    const lock = join(t.profile, "profile.lock");
    renameSync(lock, `${lock}.retained`);
    writeFileSync(lock, "", { mode: 0o600 });
    assert.throws(
      () => assertProfileIdentity(grant, t.project),
      /identity_changed/,
    );
    const alias = join(t.directory, "alias");
    symlinkSync(t.profile, alias);
    assert.throws(
      () => captureProfile({ ...t.grant, directory: alias }, t.project),
      /scope_not_admitted/,
    );
  } finally {
    rmSync(t.directory, { recursive: true });
  }
});

it("kernel lock conflict refuses profile availability until its live holder exits", async () => {
  const t = fixture();
  const grant = captureProfile(t.grant, t.project);
  const child = spawn(
    "flock",
    [
      "--exclusive",
      "--no-fork",
      join(t.profile, "profile.lock"),
      process.execPath,
      fileURLToPath(new URL("./fixtures/profile-holder.mjs", import.meta.url)),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => resolve()),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.stdout.once("data", () => resolve());
    });
    assert.throws(
      () => assertProfileAvailable(grant, t.project),
      /private_profile_busy/,
    );
    child.kill("SIGTERM");
    await closed;
    assertProfileAvailable(grant, t.project);
  } finally {
    child.kill("SIGTERM");
    rmSync(t.directory, { recursive: true });
  }
});
