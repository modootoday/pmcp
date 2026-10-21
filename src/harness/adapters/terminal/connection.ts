import { execFileSync, spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ptyBinary } from "../../../project/host.js";
import type { SessionObservation } from "../../contracts.js";
import type { RecordStore } from "./records.js";
import { resourceRunning } from "../docker/observation.js";

export type Reply = Record<string, unknown>;

// Each group has its own pmcp-pty daemon on the group's socket. Calls go through
// "pmcp-pty call", one short process each, so the harness stays synchronous.
export class Connection {
  constructor(readonly records: RecordStore) {}

  binary(): string {
    const found = ptyBinary(process.env);
    if (!found)
      throw new Error(
        "terminal_host_missing: set PMCP_PTY_BIN or put pmcp-pty on PATH",
      );
    return found;
  }

  call(request: Reply, timeoutMs = 10_000): Reply {
    let out: string;
    try {
      out = execFileSync(
        this.binary(),
        ["call", "--socket", this.records.socket, JSON.stringify(request)],
        {
          encoding: "utf8",
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch (error) {
      throw new Error("terminal_host_unavailable", { cause: error });
    }
    return JSON.parse(out) as Reply;
  }

  // A call that must succeed; pmcp-pty's code becomes the error, prefixed for the receipt.
  must(request: Reply, timeoutMs?: number): Reply {
    const reply = this.call(request, timeoutMs);
    if (reply["ok"] !== true)
      throw new Error(`terminal_${String(reply["code"] ?? "refused")}`);
    return reply;
  }

  alive(): boolean {
    if (!existsSync(this.records.socket)) return false;
    try {
      return this.call({ op: "list" }, 3_000)["ok"] === true;
    } catch {
      return false;
    }
  }

  instance(): string {
    return String(this.must({ op: "list" })["instance"]);
  }

  // Starts the group's daemon when none answers. Its output goes to pmcp-pty.log beside the
  // socket, so a failed start can say why.
  ensure(): string {
    if (this.alive()) return this.instance();
    const log = join(this.records.directory, "pmcp-pty.log");
    const fd = openSync(log, "a", 0o600);
    try {
      spawn(this.binary(), ["daemon", "--socket", this.records.socket], {
        detached: true,
        stdio: ["ignore", fd, fd],
      }).unref();
    } finally {
      closeSync(fd);
    }
    for (let waited = 0; waited < 5_000; waited += 100) {
      if (this.alive()) return this.instance();
      spawnSync("sleep", ["0.1"]);
    }
    const tail = existsSync(log) ? readFileSync(log, "utf8").slice(-400) : "";
    throw new Error(
      `terminal_host_start_failed${tail ? `: ${tail.trim()}` : ""}`,
    );
  }

  inspect(id: string): SessionObservation {
    const record = this.records.read(id);
    const seen = this.must({ op: "observe", id: record.ptySession, lines: 0 });
    if (seen["instance"] !== record.ptyInstance)
      throw new Error("stale_server");
    if (Number(seen["pid"]) !== record.pid) throw new Error("stale_pane");
    const labels = (seen["labels"] ?? {}) as Record<string, string>;
    if (
      labels["pmcp.owner"] !== this.records.owner ||
      labels["pmcp.session"] !== id
    )
      throw new Error("foreign_pane");
    const size = (seen["size"] ?? {}) as { cols?: number; rows?: number };
    return {
      ...record,
      alive:
        seen["alive"] === true &&
        (!record.resource || resourceRunning(record.resource)),
      width: Number(size.cols ?? 0),
      height: Number(size.rows ?? 0),
    };
  }

  // The identity every input carries, so pmcp-pty refuses a restarted daemon or a reused id.
  expect(record: { ptyInstance: string; pid: number }, lease?: string): Reply {
    return {
      instance: record.ptyInstance,
      pid: record.pid,
      ...(lease ? { lease } : {}),
    };
  }
}
