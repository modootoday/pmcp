import { skipReason } from "./acquire.js";
import { readQueue, runningWeight } from "./admit.js";
import type { LeaseSettings } from "./config.js";
import { etas, graceRuns, logLines, runMedians } from "./estimate.js";
import {
  LANES,
  epoch,
  leaseHeld,
  leasePaths,
  type LeaseRecord,
} from "./files.js";
import { hostSources, readHost } from "./host.js";
import { outsideLease, type OutsideProcess } from "./procs.js";
import { settled } from "./settle.js";
import { recentTickets } from "./tickets.js";

// pmcp heavy status --json, schema pmcp.heavy.status.v1: what a fleet view polls. It only
// reads (no record is pruned, nothing written) and samples /proc for a quarter second.

export const STATUS_SCHEMA = "pmcp.heavy.status.v1";

export interface JobJson {
  readonly id: string | null;
  readonly pid: number;
  readonly label: string;
  readonly cwd: string;
  readonly lane: string;
  readonly weight: number;
  readonly session: string | null;
  readonly started: string;
  readonly running_s: number;
  readonly flags: readonly string[];
  readonly bypass_reason: string | null;
}

export interface WaiterJson {
  readonly id: string | null;
  readonly pid: number;
  readonly label: string;
  readonly cwd: string;
  readonly lane: string;
  readonly weight: number;
  readonly session: string | null;
  readonly position: number;
  readonly waited_s: number;
  readonly eta_s: number | null;
}

function flags(settings: LeaseSettings, job: LeaseRecord, now: number) {
  const held = now - job.since;
  return [
    ...(job.grace ? ["grace"] : []),
    ...(job.bypass ? ["bypass"] : []),
    ...(held >= settings.holdWarn ? ["over_hold_warn"] : []),
    ...(settings.holdMax && held >= settings.holdMax ? ["over_hold_max"] : []),
  ];
}

function job(
  settings: LeaseSettings,
  record: LeaseRecord,
  now: number,
): JobJson {
  return {
    id: record.id || null,
    pid: record.pid,
    label: record.label,
    cwd: record.cwd,
    lane: record.lane,
    weight: record.weight,
    session: record.session || null,
    started: record.started,
    running_s: now - record.since,
    flags: flags(settings, record, now),
    bypass_reason: record.bypass || null,
  };
}

function number(value: string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export function statusJson(
  settings: LeaseSettings,
  env: Readonly<Record<string, string | undefined>>,
  outside: (pids: readonly number[]) => readonly OutsideProcess[] = (pids) =>
    outsideLease({ holders: pids, interval: 0.25 }),
) {
  const paths = leasePaths(settings.dir);
  const reading = readHost(hostSources(env));
  const now = epoch();
  const { running, waiters } = settings.enabled
    ? readQueue(paths, false)
    : { running: [], waiters: [] };
  const log = settings.enabled ? logLines(paths.log) : [];
  const eta = etas(runMedians(log), settings.budget, running, waiters, now);
  return {
    version: 1,
    schema: STATUS_SCHEMA,
    enabled: settings.enabled,
    dir: settings.dir,
    budget: settings.budget,
    running_weight: runningWeight(running),
    // A shell wrapper holds the lock file exclusively and counts as the whole budget.
    legacy_holder: settings.enabled && running.length === 0 && leaseHeld(paths),
    host: {
      load1: number(reading.load),
      io_some_avg10: number(reading.pressure["avg10"]),
      io_some_avg60: number(reading.pressure["avg60"]),
      io_some_avg300: number(reading.pressure["avg300"]),
      io_window: settings.ioWindow,
      max_load: settings.maxLoad,
      max_io: settings.maxIo,
      hard_factor: settings.hardFactor,
      settled: settled(settings, reading),
    },
    lanes: LANES.map((lane) => ({
      lane,
      slots: settings.slots[lane],
      running: running
        .filter((record) => record.lane === lane)
        .map((record) => job(settings, record, now)),
    })),
    waiters: waiters.map((record, at): WaiterJson => ({
      id: record.id || null,
      pid: record.pid,
      label: record.label,
      cwd: record.cwd,
      lane: record.lane,
      weight: record.weight,
      session: record.session || null,
      position: at + 1,
      waited_s: now - record.since,
      eta_s: eta[at] ?? null,
    })),
    tickets: settings.enabled
      ? recentTickets(settings.dir).map((view) => ({
          id: view.id,
          state: view.state,
          position: view.position,
          label: view.label,
          pid: view.pid,
          exit: view.result?.exit ?? null,
        }))
      : [],
    grace_24h: graceRuns(log),
    outside: settings.enabled
      ? outside(running.map((record) => record.pid)).map((item) => ({
          pid: item.pid,
          cpu_percent: Math.round(item.cpu),
          io_mbps: Math.round(item.ioMbps * 10) / 10,
          command: item.command,
        }))
      : [],
    skip: skipReason(settings, env),
  };
}
