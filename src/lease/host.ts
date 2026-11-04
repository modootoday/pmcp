import { readFileSync, writeFileSync } from "node:fs";

import type { LeaseSettings } from "./config.js";
import { nowUtc, type LeasePaths } from "./files.js";

// The readings as the files print them; null where the host has no such file (no PSI, not
// Linux), and a missing reading never holds a job back.
export interface HostSources {
  readonly loadavg: string;
  readonly pressure: string;
}

export interface HostReading {
  readonly load: string | null;
  readonly io: string | null;
}

export function hostSources(
  env: Readonly<Record<string, string | undefined>>,
): HostSources {
  return {
    loadavg: env["PMCP_HEAVY_LOADAVG_FILE"] || "/proc/loadavg",
    pressure: env["PMCP_HEAVY_PRESSURE_FILE"] || "/proc/pressure/io",
  };
}

function read(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function readHost(sources: HostSources): HostReading {
  const load = read(sources.loadavg)?.split(" ")[0]?.trim() || null;
  const pressure = read(sources.pressure);
  const io = pressure?.match(/^some avg10=([0-9.]+)/mu)?.[1] ?? null;
  return { load, io };
}

export function hostNow(reading: HostReading): string {
  return `load ${reading.load ?? "n/a"} io ${reading.io ?? "n/a"}`;
}

export function below(value: string | null, max: number): boolean {
  return value === null || Number(value) < max;
}

// Records each moment it finds the host settled, so status can say when that last was.
export function hostSettled(
  settings: LeaseSettings,
  paths: LeasePaths,
  sources: HostSources,
): boolean {
  const reading = readHost(sources);
  if (!below(reading.load, settings.maxLoad)) return false;
  if (!below(reading.io, settings.maxIo)) return false;
  try {
    writeFileSync(paths.settled, `${nowUtc()}\n`);
  } catch {
    // Status only loses the "last seen" time.
  }
  return true;
}

export function sleepSeconds(seconds: number): void {
  if (seconds <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
}
