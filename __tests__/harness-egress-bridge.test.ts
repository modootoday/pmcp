import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "vitest";
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { connect, createServer } from "node:net";
import { join } from "node:path";
import { egressPolicy } from "../src/harness/runtimes/egress-policy.js";
import { createLoopbackBridge } from "../src/harness/adapters/egress/bridge-listener.js";
import { assertBridge } from "../src/harness/adapters/docker/bridge-artifact.js";
import { containerEntrypoint } from "../src/harness/adapters/docker/entrypoint.js";
import type { DockerPolicy } from "../src/harness/contracts.js";
import type { DockerCreation } from "../src/harness/adapters/docker/creation-plan.js";

it("bridge interpreter is explicitly granted as a canonical absolute executable", () => {
  assert.deepEqual(egressPolicy({ hosts: ["api.openai.com"] }), {
    hosts: ["api.openai.com"],
  });
  assert.equal(
    egressPolicy({ hosts: ["api.openai.com"], bridgeExecutable: "/bin/node" })
      .bridgeExecutable,
    "/bin/node",
  );
  for (const bridgeExecutable of ["node", "/bin/../node", "/bin/node\n", ""])
    assert.throws(() =>
      egressPolicy({ hosts: ["api.openai.com"], bridgeExecutable }),
    );
});

it("bridge wrapping leaves native command and arguments intact and defaults unwrapped", () => {
  const policy: DockerPolicy = {
    schemaVersion: 1,
    image: `sha256:${"a".repeat(64)}`,
    network: "none",
    workspaceAccess: "read-only",
    commands: { "codex-cli": ["/bin/codex", "--no-alt-screen"] },
  };
  assert.deepEqual(containerEntrypoint(policy, "codex-cli", "12345678"), [
    "/bin/codex",
    "--no-alt-screen",
  ]);
  policy.egress = { hosts: ["api.openai.com"], bridgeExecutable: "/bin/node" };
  assert.deepEqual(containerEntrypoint(policy, "codex-cli", "12345678"), [
    "/bin/node",
    "/state/.pmcp-egress-12345678.mjs",
    "--",
    "/bin/codex",
    "--no-alt-screen",
  ]);
});

it("bridge artifact rejects content drift, broad permissions and symbolic aliases", () => {
  const directory = mkdtempSync(join(tmpdir(), "pmcp-bridge-unit-"));
  chmodSync(directory, 0o700);
  const path = join(directory, ".pmcp-egress-12345678.mjs");
  const content = Buffer.from("process.exit(0);\n");
  const creation: DockerCreation = {
    name: "unit",
    nonce: "12345678",
    state: directory,
    configuration: {},
    egress: { hosts: ["api.openai.com"], bridgeExecutable: "/bin/node" },
    bridgeSha256: createHash("sha256").update(content).digest("hex"),
  };
  try {
    writeFileSync(path, content, { mode: 0o600 });
    assertBridge(creation);
    writeFileSync(path, "process.exit(1);\n");
    assert.throws(() => assertBridge(creation), /artifact_changed/);
    writeFileSync(path, content);
    chmodSync(path, 0o644);
    assert.throws(() => assertBridge(creation), /artifact_changed/);
    rmSync(path);
    const target = join(directory, "alias.mjs");
    writeFileSync(target, content, { mode: 0o600 });
    symlinkSync(target, path);
    assert.throws(() => assertBridge(creation));
  } finally {
    rmSync(directory, { recursive: true });
  }
});

it("loopback bridge relays exact bytes over Unix IPC and closes its listeners", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pmcp-bridge-ipc-"));
  const path = join(directory, "s");
  const server = createServer((socket) => socket.pipe(socket));
  await new Promise<void>((resolve) => server.listen(path, resolve));
  const bridge = await createLoopbackBridge(path);
  const url = new URL(bridge.url);
  assert.equal(url.hostname, "127.0.0.1");
  try {
    const message = "CONNECT api.openai.com:443 HTTP/1.1\r\n\r\n";
    const response = await new Promise<string>((resolve, reject) => {
      const socket = connect({ host: url.hostname, port: Number(url.port) });
      socket.once("error", reject);
      socket.setTimeout(1000, () => socket.destroy(new Error("unit_timeout")));
      socket.once("connect", () => socket.write(message));
      socket.once("data", (chunk) => {
        socket.destroy();
        resolve(chunk.toString("utf8"));
      });
    });
    assert.equal(response, message);
    await bridge.close();
    await assert.rejects(
      new Promise<void>((resolve, reject) => {
        const socket = connect({ host: url.hostname, port: Number(url.port) });
        socket.once("error", reject);
        socket.once("connect", () => {
          socket.destroy();
          resolve();
        });
      }),
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true });
  }
});
