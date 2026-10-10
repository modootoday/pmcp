import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { it } from "vitest";
import {
  chmodSync,
  closeSync,
  constants,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  statSync,
} from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { egressPolicy } from "../src/harness/runtimes/egress-policy.js";
import {
  destination,
  publicAddress,
} from "../src/harness/adapters/egress/destination.js";
import { createEgressProxy } from "../src/harness/adapters/egress/server.js";

it("HTTPS grants require distinct exact public DNS names", () => {
  assert.deepEqual(egressPolicy({ hosts: ["AUTH.OPENAI.COM"] }), {
    hosts: ["auth.openai.com"],
  });
  for (const hosts of [
    [],
    ["localhost"],
    ["*.openai.com"],
    ["https://auth.openai.com"],
    ["127.0.0.1"],
    ["0177.0.0.1"],
    ["peer.local"],
    ["a..com"],
    ["auth.openai.com", "AUTH.OPENAI.COM"],
  ])
    assert.throws(() => egressPolicy({ hosts }));
});

it("CONNECT admission rejects alternate destinations, ports and non-ASCII aliases", () => {
  const hosts = ["auth.openai.com"];
  assert.equal(
    destination(
      Buffer.from(
        "CONNECT auth.openai.com:443 HTTP/1.1\r\nHost: auth.openai.com",
      ),
      hosts,
    ),
    hosts[0],
  );
  for (const line of [
    "GET https://auth.openai.com/ HTTP/1.1",
    "CONNECT auth.openai.com:80 HTTP/1.1",
    "CONNECT auth.openai.com.:443 HTTP/1.1",
    "CONNECT example.com:443 HTTP/1.1",
    "CONNECT auth.openai.com:443 HTTP/2.0",
  ])
    assert.equal(destination(Buffer.from(line), hosts), undefined);
  const alias = Buffer.from("CONNECT auth.openai.com:443 HTTP/1.1");
  alias[8] = alias[8]! + 128;
  assert.equal(destination(alias, hosts), undefined);
});

it("DNS results cannot select loopback, private, reserved or mapped addresses", () => {
  for (const address of [
    "0.1.2.3",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.31.0.1",
    "192.0.0.8",
    "192.0.2.1",
    "192.168.0.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::ffff:127.0.0.1",
    "0177.0.0.1",
  ])
    assert.equal(publicAddress(address), false);
  for (const address of ["1.1.1.1", "104.18.1.1", "172.64.1.1"])
    assert.equal(publicAddress(address), true);
});

it("private relay bounds its audit and supports a long owned directory without public listening", async () => {
  const root = mkdtempSync(join(tmpdir(), "pmcp-egress-unit-"));
  const directory = join(root, "a".repeat(100));
  mkdirSync(directory, { mode: 0o700 });
  let events: unknown[] = [];
  const proxy = await createEgressProxy(
    directory,
    "e12345678",
    ["auth.openai.com"],
    (value) => {
      events = value;
    },
  );
  const descriptor = openSync(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY,
  );
  const socketPath = `/proc/self/fd/${descriptor}/e12345678`;
  assert.equal(statSync(join(directory, "e12345678")).mode & 0o777, 0o600);
  assert.equal(statSync(join(directory, "e12345678")).isSocket(), true);
  try {
    for (let index = 0; index < 130; index += 1) {
      const response = await new Promise<string>((resolve, reject) => {
        const socket = connect({ path: socketPath });
        socket.on("error", reject);
        socket.setTimeout(1000, () =>
          socket.destroy(new Error("unit_response_timeout")),
        );
        socket.once("connect", () =>
          socket.write("CONNECT peer.example.com:443 HTTP/1.1\r\n\r\n"),
        );
        socket.once("data", (chunk) => {
          socket.destroy();
          resolve(chunk.toString("utf8"));
        });
      });
      assert.match(response, /^HTTP\/1.1 403/);
    }
    assert.equal(events.length, 128);
  } finally {
    await proxy.close();
    closeSync(descriptor);
    rmSync(root, { recursive: true });
  }
});

it("relay refuses broadly readable profile directories before binding", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pmcp-egress-mode-"));
  chmodSync(directory, 0o755);
  try {
    await assert.rejects(
      createEgressProxy(directory, "e12345678", ["auth.openai.com"], () => {}),
      /unsafe_egress_directory/,
    );
  } finally {
    rmSync(directory, { recursive: true });
  }
});
