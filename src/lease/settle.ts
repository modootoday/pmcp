import type { LeaseSettings } from "./config.js";
import type { HostReading } from "./host.js";

// The host check a waiter passes before it starts, read under the admission lock. Below the
// limits it starts. Past load_grace it may start into moderate overload, but only while no
// leased job runs, so a grace never starts two jobs together; never at hard_factor times a
// limit or more. load_grace 0 is no grace.

export type HostVerdict =
  "settled" | "grace" | "hook" | "tiny" | "settle" | "wait" | "severe";

export interface Waiting {
  readonly lane: string;
  readonly weight: number;
  readonly grace: number;
  // Seconds since this job queued, and since a leased job last ended (null: none since).
  readonly waited: number;
  readonly sinceRelease: number | null;
  readonly runningWeight: number;
}

function io(settings: LeaseSettings, reading: HostReading): string | null {
  return reading.pressure[settings.ioWindow] ?? reading.io;
}

function over(value: string | null, max: number): boolean {
  return value !== null && Number(value) >= max;
}

export function settled(
  settings: LeaseSettings,
  reading: HostReading,
): boolean {
  return (
    !over(reading.load, settings.maxLoad) &&
    !over(io(settings, reading), settings.maxIo)
  );
}

export function severe(settings: LeaseSettings, reading: HostReading): boolean {
  const factor = settings.hardFactor;
  return (
    over(reading.load, settings.maxLoad * factor) ||
    over(io(settings, reading), settings.maxIo * factor)
  );
}

// Below the hard ceiling, three things start a job anyway: commit-hook work is short and
// staged-only, so it does not wait on the host; a job that ended leaves its own IO behind for
// a while, so settle_window after a release the queue moves on; and load_grace.
export function hostVerdict(
  settings: LeaseSettings,
  reading: HostReading,
  waiting: Waiting,
): HostVerdict {
  if (settled(settings, reading)) return "settled";
  if (severe(settings, reading)) return "severe";
  if (waiting.lane === "hook") return "hook";
  if (waiting.weight === 0) return "tiny";
  const window = settings.settleWindow;
  if (
    window > 0 &&
    waiting.sinceRelease !== null &&
    waiting.sinceRelease >= window
  )
    return "settle";
  if (
    waiting.grace > 0 &&
    waiting.waited >= waiting.grace &&
    waiting.runningWeight === 0
  )
    return "grace";
  return "wait";
}
