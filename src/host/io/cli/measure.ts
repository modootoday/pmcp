import { mkdirSync, statfsSync } from "node:fs";
import { resolve } from "node:path";

import {
  ArgumentError,
  EXIT,
  one,
  type CommandContext,
} from "../../../cli/command.js";
import { VERSION } from "../../../commands/version.js";
import { modelLine } from "../model.js";
import { modelOf, type Probes } from "../probe.js";
import { recordPath, writeRecord, type DeviceRecord } from "../record.js";
import { deviceOf, liveCost, SYSFS, wholeDisk } from "../sysfs.js";
import { leaseOf, linuxOnly, probeDir, seconds, underLease } from "./shared.js";

const SIZE_MB = 1024;

function lineOf(
  lines:
    | readonly { device: string; fields: Readonly<Record<string, string>> }[]
    | null,
  device: string,
): string | null {
  const line = lines?.find((entry) => entry.device === device);
  if (line === undefined) return null;
  const fields = Object.entries(line.fields).map(
    ([key, value]) => `${key}=${value}`,
  );
  return [device, ...fields].join(" ");
}

export async function ioMeasure(context: CommandContext): Promise<number> {
  const refused = linuxOnly(context, "measure");
  if (refused !== null) return refused;
  const lease = leaseOf(context);
  const given = one(context.args, "dir");
  const base = resolve(context.cwd, given ?? lease.dir);
  if (given === undefined) mkdirSync(base, { recursive: true });
  const perPattern = seconds(context, 8);
  const live = liveCost(SYSFS);
  if (live.model === null) {
    context.ui.error(
      "this kernel has no io.cost (cgroup v1, or blk-iocost not built in); nothing to measure for",
    );
    return EXIT.missingOptional;
  }
  let device: string;
  try {
    device = wholeDisk(SYSFS, deviceOf(base));
  } catch (error) {
    throw new ArgumentError(`--dir ${base}: ${(error as Error).message}`);
  }
  const fs = statfsSync(base);
  const free = Number(fs.bavail) * Number(fs.bsize);
  if (free < 2 * SIZE_MB * 2 ** 20)
    throw new ArgumentError(
      `${base} has ${Math.floor(free / 2 ** 20)} MiB free; the probe needs ${2 * SIZE_MB} MiB`,
    );
  const qos = live.qos?.find((line) => line.device === device);
  if (qos?.fields["ctrl"] === "user" && Number(qos.fields["max"]) <= 100)
    context.ui.warn(
      `io.cost.qos on ${device} caps vrate at the current model, so a faster disk reads as that model; set qos ctrl=auto first to measure past it`,
    );
  const { code, result } = await underLease<Probes>(context, lease, {
    verb: "measure",
    job: {
      kind: "measure",
      dir: probeDir(base),
      sizeMb: SIZE_MB,
      seconds: perPattern,
    },
    scoped: true,
  });
  if (result === null) return code === 0 ? EXIT.failure : code;
  const entry: DeviceRecord = {
    device,
    measured_at: new Date().toISOString(),
    pmcp: VERSION,
    dir: base,
    seconds: perPattern,
    size_mb: SIZE_MB,
    model: modelOf(result),
    probes: result,
    live_model: lineOf(live.model, device),
    live_qos: lineOf(live.qos, device),
  };
  writeRecord(lease.dir, entry);
  if (context.args.flags.has("json")) {
    context.ui.data(`${JSON.stringify({ version: 1, ...entry })}\n`);
    return EXIT.ok;
  }
  const rows = Object.entries(result).map(
    ([name, rate]) =>
      `${name}  ${rate.iops} IOPS  ${Math.round(rate.bps / 1e6)} MB/s  ${rate.seconds}s`,
  );
  context.ui.results.records([
    ...rows,
    `model  ${modelLine(device, entry.model)}`,
    `recorded in ${recordPath(lease.dir)}; pmcp host io plan prints what to install`,
  ]);
  return EXIT.ok;
}
