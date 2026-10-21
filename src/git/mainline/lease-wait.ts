import type { LeaseSpec, Reporter } from "../types.js";
import type { Lease, SessionGate } from "./store.js";

function foreign(
  store: SessionGate,
  specs: readonly LeaseSpec[],
): { name: string; lease: Lease } | null {
  for (const spec of specs) {
    const lease = store.leases.read(spec.name);
    if (lease !== null && lease.pid !== process.pid)
      return { name: spec.name, lease };
  }
  return null;
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Keep the live index locked until its replacement is ready to prevent concurrent index corruption.
export function waitForLeases(
  store: SessionGate,
  specs: readonly LeaseSpec[],
  waitSeconds: number,
  report: Reporter,
  pollMs = 1000,
): string | null {
  const deadline = Date.now() + waitSeconds * 1000;
  let announced = false;
  for (;;) {
    const held = foreign(store, specs);
    if (held === null) return null;
    const { name, lease } = held;
    const who = `${lease.subject} (pid ${lease.pid}, since ${lease.since})`;
    if (!announced) {
      report.info(`waiting for lease ${name}: ${who}`);
      announced = true;
    }
    const left = deadline - Date.now();
    if (left <= 0)
      return `lease ${name} is still held after ${waitSeconds}s by ${who}; ask its owner`;
    sleep(Math.min(pollMs, left));
  }
}
