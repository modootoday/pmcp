import { closeSync, mkdirSync, openSync, rmSync } from "node:fs";
import { join } from "node:path";

import { flock } from "../git/mainline/lock.js";
import { flockAvailable } from "../locks/file-lock.js";
import { DISABLE_ENV, type LeaseSettings } from "./config.js";
import {
  describeRecord,
  epoch,
  leaseHeld,
  leasePaths,
  liveWaiters,
  logEvent,
  pidAlive,
  readRecord,
  removeRecord,
  writeRecord,
  type LeasePaths,
} from "./files.js";
import {
  hostNow,
  hostSettled,
  hostSources,
  readHost,
  sleepSeconds,
  type HostSources,
} from "./host.js";

export type LeaseOutcome =
  | {
      readonly kind: "held";
      readonly env: Readonly<Record<string, string>>;
      release(rc: number, ran: number): void;
    }
  | { readonly kind: "reentrant" }
  | { readonly kind: "skipped"; readonly reason: string }
  | { readonly kind: "disabled" }
  | { readonly kind: "busy"; readonly waited: number; readonly holder: string };

export interface AcquireOptions {
  readonly settings: LeaseSettings;
  readonly profile: string;
  readonly label: string;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly say: (line: string) => void;
}

interface Run extends AcquireOptions {
  readonly paths: LeasePaths;
  readonly sources: HostSources;
  readonly pid: number;
}

// How often a waiter that is not first in line tries the lock.
const DEFER_POLL_SECONDS = 2;

export function skipReason(
  settings: LeaseSettings,
  env: AcquireOptions["env"],
): string | null {
  const own = env[DISABLE_ENV];
  if (own) return own;
  const legacy = settings.legacySkipEnv ? env[settings.legacySkipEnv] : "";
  return legacy || null;
}

// A marker is trusted only while it names the recorded, live holder of a held lease.
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
  const holder = readRecord(paths.holder);
  if (holder === null || !markers.includes(String(holder.pid))) return false;
  return pidAlive(holder.pid) && leaseHeld(paths);
}

function first(run: Run): boolean {
  const oldest = liveWaiters(run.paths)[0];
  return oldest === undefined || oldest.pid === run.pid;
}

// The first waiter in line blocks in flock, the rest poll, so release goes roughly in arrival order.
function waitForLease(run: Run, fd: number, maxWait: number): boolean {
  if (flock(fd, ["-n"]) === 0) return true;
  const started = epoch();
  let beat = started;
  const holder = () => describeRecord(readRecord(run.paths.holder));
  run.say(
    `waiting for host lease held by ${holder()}, ${hostNow(readHost(run.sources))}`,
  );
  for (;;) {
    const remaining = maxWait - (epoch() - started);
    if (remaining <= 0) return false;
    if (first(run)) {
      const step = Math.min(run.settings.heartbeat, remaining);
      if (flock(fd, ["-w", String(step)]) === 0) return true;
    } else {
      sleepSeconds(Math.min(DEFER_POLL_SECONDS, remaining));
      if (flock(fd, ["-n"]) === 0) return true;
    }
    if (epoch() - beat >= run.settings.heartbeat) {
      beat = epoch();
      run.say(
        `still waiting ${beat - started}s for ${holder()}, ${hostNow(readHost(run.sources))}`,
      );
    }
  }
}

function waitForSettledHost(run: Run, grace: number): void {
  const { settings, paths, sources } = run;
  if (hostSettled(settings, paths, sources)) return;
  const started = epoch();
  let beat = started;
  run.say(
    `holding the lease; waiting for load1 < ${settings.maxLoad} and io < ${settings.maxIo} (${hostNow(readHost(sources))})`,
  );
  while (!hostSettled(settings, paths, sources)) {
    if (epoch() - started >= grace) {
      const now = hostNow(readHost(sources));
      run.say(
        `the host stayed above the limits for ${grace}s with no other leased job (${now}); running`,
      );
      logEvent(paths, run.pid, "grace", `waited=${grace} ${now}`);
      return;
    }
    sleepSeconds(Math.min(settings.poll, grace - (epoch() - started)));
    if (epoch() - beat >= settings.heartbeat) {
      beat = epoch();
      run.say(
        `still waiting for the host to settle (${hostNow(readHost(sources))})`,
      );
    }
  }
}

function hold(run: Run, fd: number): LeaseOutcome {
  const { paths, pid, settings } = run;
  const env: Record<string, string> = { [settings.markerEnv]: String(pid) };
  if (settings.legacyMarkerEnv) env[settings.legacyMarkerEnv] = String(pid);
  let open = true;
  return {
    kind: "held",
    env,
    release(rc, ran) {
      if (!open) return;
      open = false;
      removeRecord(paths.holder, pid);
      logEvent(paths, pid, "released", `ran=${ran} rc=${rc}`);
      closeSync(fd);
    },
  };
}

export function acquireLease(options: AcquireOptions): LeaseOutcome {
  const { settings, env, label, say } = options;
  if (!settings.enabled) return { kind: "disabled" };
  const paths = leasePaths(settings.dir);
  const run: Run = {
    ...options,
    paths,
    sources: hostSources(env),
    pid: process.pid,
  };
  const skip = skipReason(settings, env);
  if (skip !== null) {
    say(`running without the host lease: ${skip}`);
    logEvent(
      paths,
      run.pid,
      "skip",
      `reason=${skip} cwd=${run.cwd} label=${label}`,
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
  mkdirSync(paths.waiters, { recursive: true });
  const fd = openSync(paths.lock, "a");
  const waiter = join(paths.waiters, String(run.pid));
  writeRecord(waiter, run.pid, run.cwd, label);
  const started = epoch();
  let got: boolean;
  try {
    got = waitForLease(run, fd, profile.maxWait);
  } finally {
    rmSync(waiter, { force: true });
  }
  if (!got) {
    closeSync(fd);
    const holder = describeRecord(readRecord(paths.holder));
    logEvent(
      paths,
      run.pid,
      "timeout",
      `waited=${profile.maxWait} label=${label}`,
    );
    return { kind: "busy", waited: profile.maxWait, holder };
  }
  writeRecord(paths.holder, run.pid, run.cwd, label);
  logEvent(
    paths,
    run.pid,
    "acquired",
    `waited=${epoch() - started} cwd=${run.cwd} label=${label}`,
  );
  waitForSettledHost(run, profile.loadGrace);
  return hold(run, fd);
}
