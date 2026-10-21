import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, type TestContext } from "vitest";

import { filesLeases } from "../../src/sessions/files/leases.js";
import { createFilesStore } from "../../src/sessions/files-store.js";
import {
  gateTree,
  leaseFilesFor,
  readGateLocation,
  readLeaseFiles,
} from "../../src/sessions/lease-files.js";

function temp(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-lease-files-"));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Another tool coordinating the same lockfile reads its lease in its own directory; pmcp takes
// and releases the lease there, with the record shape both read: {pid, subject, cwd, since}.
describe("lease files outside the state dir", () => {
  it("reads absolute, ~/ and ${gate_dir}/ paths and refuses relative ones", () => {
    expect(
      readLeaseFiles({
        lockfile: {
          path: "bun.lock",
          file: "${gate_dir}/lockfile-lease.json",
          events: "~/gate/lockfile-events.jsonl",
        },
        other: { path: "x" },
      }),
    ).toEqual({
      lockfile: {
        file: "${gate_dir}/lockfile-lease.json",
        events: join(homedir(), "gate/lockfile-events.jsonl"),
      },
    });
    expect(() =>
      readLeaseFiles({ lockfile: { file: "state/lease.json" } }),
    ).toThrow("must be absolute, start with ~/ or start with ${gate_dir}/");
  });

  it("puts ${gate_dir} beside the gate tree, which tree_env overrides", () => {
    const gate = readGateLocation({
      mainline: { gate: { tree: "/var/gate/tree", tree_env: "GATE_TREE" } },
    });
    expect(gateTree("/proj", "/state", gate, {})).toBe("/var/gate/tree");
    expect(
      gateTree("/proj", "/state", gate, { GATE_TREE: "/tmp/t/tree" }),
    ).toBe("/tmp/t/tree");
    expect(gateTree("/proj", "/state", {}, {})).toBe("/state/gate/tree");
    const files = { lockfile: { file: "${gate_dir}/lockfile-lease.json" } };
    expect(
      leaseFilesFor("/proj", "/state", files, gate, {
        GATE_TREE: "/tmp/t/tree",
      }),
    ).toEqual({
      lockfile: { file: "/tmp/t/lockfile-lease.json" },
    });
  });

  it("takes the lease at the declared file, refuses a live holder and replaces a dead one", (t) => {
    const dir = temp(t);
    const file = join(dir, "gate/lockfile-lease.json");
    const leases = filesLeases(join(dir, "state"), { lockfile: { file } });
    expect(
      leases.take("lockfile", {
        pid: process.pid,
        subject: "bump",
        cwd: "/w",
      }),
    ).toBe(true);
    const record = JSON.parse(readFileSync(file, "utf8"));
    expect(record).toMatchObject({
      pid: process.pid,
      subject: "bump",
      cwd: "/w",
    });
    expect(typeof record.since).toBe("string");

    // A live holder that is not us (our parent stands in for another tool).
    writeFileSync(
      file,
      JSON.stringify({ pid: process.ppid, subject: "theirs", since: "x" }),
    );
    expect(leases.take("lockfile", { pid: process.pid, subject: "mine" })).toBe(
      false,
    );

    // A holder whose process is gone is replaced.
    writeFileSync(
      file,
      JSON.stringify({ pid: 2 ** 22 + 7, subject: "gone", since: "x" }),
    );
    expect(leases.take("lockfile", { pid: process.pid, subject: "mine" })).toBe(
      true,
    );
    expect(JSON.parse(readFileSync(file, "utf8")).subject).toBe("mine");

    leases.release("lockfile");
    expect(() => readFileSync(file)).toThrow();
  });

  it("is what the store, and so the hook guard, reads", (t) => {
    const dir = temp(t);
    const file = join(dir, "lockfile-lease.json");
    writeFileSync(
      file,
      JSON.stringify({ pid: process.pid, subject: "bump", since: "now" }),
    );
    const store = createFilesStore(join(dir, "state"), {
      leaseFiles: { lockfile: { file } },
    });
    expect(store.leases.read("lockfile")?.subject).toBe("bump");
    expect(
      createFilesStore(join(dir, "state")).leases.read("lockfile"),
    ).toBeNull();
  });
});
