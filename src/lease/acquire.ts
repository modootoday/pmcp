import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import { flock } from "../git/mainline/lock.js";
import { flockAvailable } from "../locks/file-lock.js";
import {
  admissible,
  readQueue,
  runningFile,
  runningWeight,
  underAdmitLock,
  waiterFile,
} from "./admit.js";
import { DISABLE_ENV, type LeaseSettings } from "./config.js";
import {
  epoch,
  leaseHeld,
  newId,
  leasePaths,
  liveRecords,
  logEvent,
  pidAlive,
  readRecord,
  removeRecord,
  writeRecord,
  type LeaseLane,
  type LeasePaths,
  type RecordFields,
} from "./files.js";
import {
  hostNow,
  hostSettled,
  hostSources,
  readHost,
  sleepSeconds,
} from "./host.js";
import { parkForSession, sessionOf } from "./queue.js";
import { hostVerdict, type HostVerdict } from "./settle.js";

export type BusyReason = "queue" | "parked" | "host" | "legacy";

export type LeaseOutcome =
  | {
      readonly kind: "held";
      readonly env: Readonly<Record<string, string>>;
      // How it started: its turn in the queue, load_grace, or --now.
      readonly start: "queue" | "grace" | "bypass";
      release(rc: number, ran: number): void;
    }
  | { readonly kind: "reentrant" }
  | { readonly kind: "skipped"; readonly reason: string }
  | { readonly kind: "disabled" }
  // Cancelled in the queue by pmcp heavy cancel.
  | { readonly kind: "cancelled"; readonly reason: string }
  | {
      readonly kind: "busy";
      readonly waited: number;
      readonly lane: LeaseLane;
      readonly position: number;
      readonly reason: BusyReason;
      readonly host: string;
    };

export interface AcquireOptions {
  readonly settings: LeaseSettings;
  readonly profile: string;
  readonly label: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly say: (line: string) => void;
  readonly lane?: LeaseLane;
  readonly weight?: number;
  // An emergency start: no queue, no host check, never 75; the reason is required and logged.
  readonly now?: string;
  // A submitted ticket's id; a blocking run gets one made.
  readonly id?: string;
  // A [[host.lease.commands]] entry put this command in the bulk lane: a skip does not apply.
  readonly bulkCommand?: boolean;
}

const STEP_SECONDS = 1;

export function skipReason(
  settings: LeaseSettings,
  env: AcquireOptions["env"],
): string | null {
  const own = env[DISABLE_ENV];
  if (own) return own;
  const legacy = settings.legacySkipEnv ? env[settings.legacySkipEnv] : "";
  return legacy || null;
}

// A marker is trusted only while it names a live running job, or the recorded live holder of a
// lock a shell wrapper holds.
export function reentrant(
  settings: LeaseSettings,
  env: AcquireOptions["env"],
): boolean {
  const paths = leasePaths(settings.dir);
  const names = [settings.markerEnv, settings.legacyMarkerEnv];
  const markers = names.flatMap((name) =>
    name && env[name] ? [env[name]] : [],
  );
  if (markers.length === 0) return false;
  if (
    liveRecords(paths.running).some((job) => markers.includes(String(job.pid)))
  )
    return true;
  const holder = readRecord(paths.holder);
  if (holder === null || !markers.includes(String(holder.pid))) return false;
  return pidAlive(holder.pid) && leaseHeld(paths);
}

export function profileLane(profile: string): LeaseLane {
  if (profile === "gate" || profile === "hook") return profile;
  return "interactive";
}

export function position(paths: LeasePaths, pid: number): number {
  const index = liveRecords(paths.waiters).findIndex((r) => r.pid === pid);
  return index < 0 ? 0 : index + 1;
}

interface Attempt {
  readonly admitted: boolean;
  readonly verdict: HostVerdict | "queue" | "legacy" | "cancelled" | "promoted";
  readonly lane?: LeaseLane;
  readonly reason?: string;
}

// Under the admission lock: fit the budget and the lane, pass the host check, then hold the
// shared side of the lock file, which a shell wrapper's exclusive hold refuses.
function tryAdmit(
  options: AcquireOptions,
  paths: LeasePaths,
  fd: number,
  start: RecordFields,
  registered: number,
): Attempt {
  let fields = start;
  const pid = process.pid;
  const outcome = underAdmitLock(paths, (): Attempt => {
    // The waiter record is the source of truth: queue control rewrites it between polls.
    const mine = readRecord(waiterFile(paths, pid));
    if (mine === null || mine.cancel)
      return {
        admitted: false,
        verdict: "cancelled",
        reason: mine?.cancel || "removed",
      };
    fields = { ...fields, lane: mine.lane };
    if (mine.promote) {
      flock(fd, ["-s", "-n"]);
      writeRecord(runningFile(paths, pid), pid, {
        ...fields,
        bypass: mine.promote,
      });
      writeRecord(paths.holder, pid, fields);
      rmSync(waiterFile(paths, pid), { force: true });
      logEvent(
        paths,
        pid,
        "bypass",
        `reason=${mine.promote} cwd=${fields.cwd} label=${fields.label} lane=${fields.lane} weight=${fields.weight} id=${fields.id}`,
      );
      return { admitted: true, verdict: "promoted", lane: fields.lane };
    }
    const { running, waiters } = readQueue(paths);
    if (!admissible(options.settings, running, waiters).has(pid))
      return { admitted: false, verdict: "queue" };
    const grace = options.settings.profiles[options.profile]!.loadGrace;
    const reading = readHost(hostSources(options.env));
    const released = lastRelease(paths);
    const verdict = hostVerdict(options.settings, reading, {
      lane: fields.lane,
      weight: fields.weight,
      grace,
      waited: epoch() - registered,
      // Only a release while this job waited counts: older ones explain nothing now.
      sinceRelease:
        released !== null && released >= registered ? epoch() - released : null,
      runningWeight: runningWeight(running),
    });
    if (verdict === "wait" || verdict === "severe")
      return { admitted: false, verdict };
    if (flock(fd, ["-s", "-n"]) !== 0)
      return { admitted: false, verdict: "legacy" };
    writeRecord(runningFile(paths, pid), pid, {
      ...fields,
      queued: Date.now(),
      grace: verdict === "grace",
    });
    writeRecord(paths.holder, pid, fields);
    rmSync(waiterFile(paths, pid), { force: true });
    if (verdict !== "settled")
      logEvent(
        paths,
        pid,
        verdict,
        `waited=${epoch() - registered} ${hostNow(reading)} label=${fields.label}`,
      );
    return { admitted: true, verdict, lane: fields.lane };
  });
  return outcome ?? { admitted: false, verdict: "queue" };
}

function lastRelease(paths: LeasePaths): number | null {
  try {
    return Number(readFileSync(paths.released, "utf8").trim()) || null;
  } catch {
    return null;
  }
}

function markRelease(paths: LeasePaths): void {
  try {
    writeFileSync(paths.released, `${epoch()}\n`);
  } catch {
    // Only the settle window loses its start.
  }
}

function release(
  paths: LeasePaths,
  pid: number,
  fd: number,
  rc: number,
  ran: number,
) {
  underAdmitLock(paths, () => {
    rmSync(runningFile(paths, pid), { force: true });
    removeRecord(paths.holder, pid);
    markRelease(paths);
    // The holder record names a running job for shell wrappers' status while any runs.
    const next = liveRecords(paths.running)[0];
    if (next && readRecord(paths.holder) === null)
      writeRecord(paths.holder, next.pid, { ...next, queued: next.queued });
  });
  logEvent(paths, pid, "released", `ran=${ran} rc=${rc}`);
  closeSync(fd);
}

function held(
  options: AcquireOptions,
  paths: LeasePaths,
  fd: number,
  start: "queue" | "grace" | "bypass",
): LeaseOutcome {
  const { settings } = options;
  const pid = String(process.pid);
  const env: Record<string, string> = { [settings.markerEnv]: pid };
  if (settings.legacyMarkerEnv) env[settings.legacyMarkerEnv] = pid;
  // A shell wrapper nested in this job cannot see it as its holder; it runs at once, logged.
  if (settings.legacySkipEnv)
    env[settings.legacySkipEnv] = `inside pmcp heavy ${pid}`;
  let open = true;
  return {
    kind: "held",
    env,
    start,
    release(rc, ran) {
      if (!open) return;
      open = false;
      release(paths, process.pid, fd, rc, ran);
    },
  };
}

export function acquireLease(options: AcquireOptions): LeaseOutcome {
  const { settings, env, label, say } = options;
  if (!settings.enabled) return { kind: "disabled" };
  const paths = leasePaths(settings.dir);
  const skip = skipReason(settings, env);
  // A skip is for one ordinary command; a whole suite the project marked bulk still queues.
  if (skip !== null && options.bulkCommand === true) {
    say(
      `the lease skip (${skip}) is not honoured for a bulk command ([[host.lease.commands]] lane = "bulk"); it queues in the bulk lane. For an emergency run: pmcp heavy --now --reason <text> -- <command>`,
    );
    logEvent(
      paths,
      process.pid,
      "skip-refused",
      `reason=${skip} cwd=${options.cwd} label=${label}`,
    );
  }
  if (skip !== null && options.bulkCommand !== true) {
    say(`running without the host lease: ${skip}`);
    logEvent(
      paths,
      process.pid,
      "skip",
      `reason=${skip} cwd=${options.cwd} label=${label}`,
    );
    return { kind: "skipped", reason: skip };
  }
  if (!flockAvailable()) {
    say("flock is not installed; running without the host lease");
    return { kind: "skipped", reason: "flock is not installed" };
  }
  if (reentrant(settings, env)) return { kind: "reentrant" };
  const profile = settings.profiles[options.profile];
  if (profile === undefined)
    throw new Error(`unknown profile ${options.profile}`);
  const lane = options.lane ?? profileLane(options.profile);
  const weight = Math.min(
    options.weight ?? settings.weights[lane],
    settings.budget,
  );
  const session = sessionOf(env, options.cwd);
  const fields: RecordFields = {
    cwd: options.cwd,
    label,
    lane,
    weight,
    session,
    id: options.id ?? newId(),
  };
  mkdirSync(paths.waiters, { recursive: true });
  mkdirSync(paths.running, { recursive: true });
  if (options.now) return bypass(options, paths, fields);
  const started = epoch();
  const deadline = started + profile.maxWait;
  const parked = parkForSession({
    paths,
    lane,
    session,
    cap: settings.perSession,
    maxWait: profile.maxWait,
    say,
  });
  if (parked === null) return busy(options, paths, lane, 0, "parked", started);
  const fd = openSync(paths.lock, "a");
  writeRecord(waiterFile(paths, process.pid), process.pid, fields);
  const registered = epoch();
  let beat = 0;
  let last: Attempt["verdict"] = "queue";
  let admittedLane = lane;
  try {
    for (;;) {
      const attempt = tryAdmit(options, paths, fd, fields, registered);
      if (attempt.admitted) {
        last = attempt.verdict;
        admittedLane = attempt.lane ?? lane;
        break;
      }
      if (attempt.verdict === "cancelled") {
        closeSync(fd);
        say(`cancelled in the queue: ${attempt.reason}`);
        return { kind: "cancelled", reason: attempt.reason ?? "" };
      }
      if (last === "queue" && attempt.verdict !== "queue")
        say(
          `next in line; ${describeWait(attempt.verdict, hostNow(readHost(hostSources(env))))}`,
        );
      last = attempt.verdict;
      if (epoch() >= deadline) {
        closeSync(fd);
        const place = position(paths, process.pid);
        const reason: BusyReason =
          last === "severe" ? "host" : last === "legacy" ? "legacy" : "queue";
        return busy(options, paths, lane, place, reason, started);
      }
      if (epoch() - beat >= settings.heartbeat) {
        const { running } = readQueue(paths);
        say(
          `waiting ${epoch() - started}s; ${lane} position ${position(paths, process.pid)}, running weight ${runningWeight(running)}/${settings.budget}, ${hostNow(readHost(hostSources(env)))}`,
        );
        beat = epoch();
      }
      sleepSeconds(Math.min(STEP_SECONDS, deadline - epoch()));
    }
  } finally {
    rmSync(waiterFile(paths, process.pid), { force: true });
  }
  hostSettled(settings, paths, hostSources(env));
  logEvent(
    paths,
    process.pid,
    "acquired",
    `waited=${epoch() - started} cwd=${options.cwd} label=${label} lane=${admittedLane} weight=${weight}`,
  );
  const start =
    last === "promoted" ? "bypass" : last === "grace" ? "grace" : "queue";
  return held(options, paths, fd, start);
}

// Counted in the running weight like any job, so the others' admission sees its load.
function bypass(
  options: AcquireOptions,
  paths: LeasePaths,
  fields: RecordFields,
): LeaseOutcome {
  const fd = openSync(paths.lock, "a");
  const reason = options.now!;
  underAdmitLock(paths, () => {
    flock(fd, ["-s", "-n"]);
    writeRecord(runningFile(paths, process.pid), process.pid, {
      ...fields,
      bypass: reason,
    });
  });
  options.say(
    `BYPASS: running now, outside the queue and the host check: ${reason}`,
  );
  logEvent(
    paths,
    process.pid,
    "bypass",
    `reason=${reason} cwd=${fields.cwd} label=${fields.label} lane=${fields.lane} weight=${fields.weight}`,
  );
  return held(options, paths, fd, "bypass");
}

function describeWait(verdict: Attempt["verdict"], host: string): string {
  if (verdict === "severe")
    return `the host is at hard_factor x a limit (${host})`;
  if (verdict === "wait") return `waiting for the host to settle (${host})`;
  if (verdict === "legacy") return "a shell wrapper holds the whole lease";
  return "waiting";
}

function busy(
  options: AcquireOptions,
  paths: LeasePaths,
  lane: LeaseLane,
  place: number,
  reason: BusyReason,
  started: number,
): LeaseOutcome {
  const profile = options.settings.profiles[options.profile]!;
  const host = hostNow(readHost(hostSources(options.env)));
  logEvent(
    paths,
    process.pid,
    "timeout",
    `waited=${profile.maxWait} label=${options.label} lane=${lane} position=${place} reason=${reason}`,
  );
  return {
    kind: "busy",
    waited: epoch() - started,
    lane,
    position: place,
    reason,
    host,
  };
}
