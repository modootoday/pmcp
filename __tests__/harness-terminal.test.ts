import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Backend } from "../src/harness/adapters/terminal/backend.js";
import { spawnRequest } from "../src/harness/adapters/terminal/lifecycle.js";
import {
  RecordStore,
  runtimeUnit,
} from "../src/harness/adapters/terminal/records.js";

// The group backend against a real pmcp-pty daemon and a plain cat, no agent runtime.
const PTY = resolve(
  import.meta.dirname,
  "../crates/pmcp-pty/target/debug/pmcp-pty",
);

let directory: string;
let backend: Backend;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "pmcp-term-"));
  vi.stubEnv("XDG_STATE_HOME", join(directory, "state"));
  vi.stubEnv("PMCP_PTY_BIN", PTY);
  backend = new Backend(RecordStore.create());
});
afterEach(() => {
  try {
    if (backend.connection.alive())
      backend.connection.call({ op: "shutdown" }, 30_000);
  } catch {}
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

function session(): string {
  const id = randomUUID();
  const connection = backend.connection;
  const instance = connection.ensure();
  const spawned = connection.must({
    op: "spawn",
    name: `pmcp-${id}`,
    argv: ["cat"],
    labels: {
      "pmcp.owner": backend.owner,
      "pmcp.session": id,
      "pmcp.launch": "n",
    },
  });
  backend.recordStore.save({
    id,
    owner: backend.owner,
    runtime: "codex-cli",
    socket: backend.socket,
    ptySession: String(spawned["id"]),
    ptyInstance: instance,
    pid: Number(spawned["pid"]),
    unit: runtimeUnit(id),
    memoryMb: 64,
    cwd: directory,
    createdAt: new Date().toISOString(),
  });
  return id;
}

it.skipIf(!existsSync(PTY))(
  "starts a group daemon, writes and reads through it, and honours the harness lease",
  () => {
    const id = session();
    const seen = backend.inspect(id);
    expect(seen.alive).toBe(true);
    expect(seen.width).toBeGreaterThan(0);
    backend.write(id, "hello-term", { submit: true });
    const deadline = Date.now() + 5_000;
    let text = "";
    while (Date.now() < deadline && !text.includes("hello-term"))
      text = backend.read(id, { lines: 20 }).content;
    expect(text).toContain("hello-term");
    backend.lease(id, "tok");
    expect(() => backend.write(id, "no-token", { submit: false })).toThrow(
      "native_writer_active",
    );
    backend.write(id, "with-token", { submit: false, lease: "tok" });
    backend.lease(id, null, "tok");
    expect(backend.attachers(id)).toEqual([]);
    backend.stop(id);
    expect(backend.recordStore.read(id).stoppedAt).toBeTruthy();
    backend.cleanup();
    expect(backend.connection.alive()).toBe(false);
  },
);

it.skipIf(!existsSync(PTY))(
  "refuses a session whose daemon restarted or whose labels belong to another owner",
  () => {
    const id = session();
    const record = backend.recordStore.read(id);
    backend.recordStore.save({ ...record, ptyInstance: "1-1" });
    expect(() => backend.inspect(id)).toThrow("stale_server");
    const other = backend.connection.must({
      op: "spawn",
      argv: ["cat"],
      labels: { "pmcp.owner": "someone-else", "pmcp.session": id },
    });
    backend.recordStore.save({
      ...record,
      ptySession: String(other["id"]),
      pid: Number(other["pid"]),
    });
    expect(() => backend.inspect(id)).toThrow("foreign_pane");
  },
);

// Live, the gate died with terminal_host_missing: pmcp-pty was found only through PMCP_PTY_BIN
// and the spawn dropped it. A gate spawned this way must still reach its group's daemon.
it.skipIf(!existsSync(PTY))(
  "gives a launch gate the pmcp-pty this harness found through PMCP_PTY_BIN alone",
  () => {
    vi.stubEnv("PATH", "/usr/bin:/bin");
    const connection = backend.connection;
    connection.ensure();
    const script = [
      'printf "bin=%s\\n" "$PMCP_PTY_BIN"',
      `"$PMCP_PTY_BIN" call --socket "$PMCP_PTY_SOCKET" '{"op":"list"}' >/dev/null && echo reached`,
      "cat",
    ].join("; ");
    const request = spawnRequest(
      connection,
      randomUUID(),
      "n",
      ["sh", "-c", script],
      directory,
      "codex-cli",
    );
    const spawned = connection.must(request);
    const deadline = Date.now() + 5_000;
    let text = "";
    while (Date.now() < deadline && !text.includes("reached"))
      text = String(
        connection.must({ op: "tail", id: spawned["id"], strip: true })[
          "text"
        ] ?? "",
      );
    expect(text).toContain(`bin=${PTY}`);
    expect(text).toContain("reached");
  },
);
