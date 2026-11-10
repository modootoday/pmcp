import { MODEL_KEYS, type CostLine } from "./model.js";
import type { IoRecord } from "./record.js";
import type { LiveCost } from "./sysfs.js";
import type { CompareResult } from "./jobs.js";

export interface Finding {
  readonly level: "ok" | "warn";
  readonly device: string | null;
  readonly message: string;
}

// Below this IOPS ratio between weight 100 and 25 the weights are not doing their job.
export const WEIGHT_RATIO_FLOOR = 2;

function lineFor(lines: readonly CostLine[], device: string) {
  return lines.find((line) => line.device === device);
}

function modelFindings(
  device: string,
  record: IoRecord,
  live: readonly CostLine[],
): Finding[] {
  const recorded = record.devices[device]!;
  const line = lineFor(live, device);
  const warn = (message: string): Finding => ({
    level: "warn",
    device,
    message,
  });
  if (line === undefined)
    return [warn(`the kernel has no io.cost model for ${device}`)];
  const found: Finding[] = [];
  if (line.fields["ctrl"] !== "user")
    found.push(
      warn(
        `io.cost.model ctrl=${line.fields["ctrl"] ?? "?"}: the kernel's own estimate is in use, not the recorded model`,
      ),
    );
  const differ = MODEL_KEYS.filter(
    (key) => Number(line.fields[key]) !== recorded.model[key],
  ).map(
    (key) =>
      `${key} live ${line.fields[key] ?? "none"}, recorded ${recorded.model[key]}`,
  );
  if (differ.length > 0)
    found.push(
      warn(`io.cost.model differs from the record: ${differ.join("; ")}`),
    );
  if (found.length === 0)
    found.push({
      level: "ok",
      device,
      message: `io.cost.model matches the record measured ${recorded.measured_at}`,
    });
  return found;
}

function qosFindings(device: string, live: readonly CostLine[]): Finding[] {
  const line = lineFor(live, device);
  const warn = (message: string): Finding => ({
    level: "warn",
    device,
    message,
  });
  if (line === undefined)
    return [warn(`the kernel has no io.cost qos for ${device}`)];
  const found: Finding[] = [];
  if (line.fields["enable"] !== "1")
    found.push(
      warn("io.cost.qos enable=0: iocost is off, so io.weight does nothing"),
    );
  if (line.fields["ctrl"] !== "user")
    found.push(
      warn(
        `io.cost.qos ctrl=${line.fields["ctrl"] ?? "?"}: the kernel moves vrate itself and may run far past the model`,
      ),
    );
  const max = Number(line.fields["max"]);
  if (!(max <= 100))
    found.push(
      warn(
        `io.cost.qos max=${line.fields["max"] ?? "none"} exceeds 100: vrate can outrun the model`,
      ),
    );
  if (found.length === 0)
    found.push({
      level: "ok",
      device,
      message: "io.cost.qos caps vrate at the model (ctrl=user, max<=100)",
    });
  return found;
}

// Null live files mean no io.cost on this kernel at all; the caller reports that apart.
export function diagnose(record: IoRecord | null, live: LiveCost): Finding[] {
  if (record === null || Object.keys(record.devices).length === 0)
    return [
      {
        level: "warn",
        device: null,
        message: "no io model recorded; run pmcp host io measure",
      },
    ];
  return Object.keys(record.devices)
    .sort()
    .flatMap((device) => [
      ...modelFindings(device, record, live.model ?? []),
      ...qosFindings(device, live.qos ?? []),
    ]);
}

// A qos under ctrl=user holds vrate to the current model, so a probe would measure the cap.
export function measureRefusal(
  live: LiveCost,
  device: string,
): string[] | null {
  const line = lineFor(live.qos ?? [], device);
  if (line?.fields["ctrl"] !== "user") return null;
  return [
    `io.cost.qos on ${device} is ctrl=user, so vrate is held to the current model and a probe would measure that cap`,
    `lift the cap for the measurement as root: echo '${device} enable=1 ctrl=auto' > /sys/fs/cgroup/io.cost.qos`,
    "afterwards pmcp host io plan prints the capped qos line to restore",
  ];
}

export function weightFinding(result: CompareResult): Finding {
  if (!result.valid || result.ratio === null)
    return {
      level: "warn",
      device: null,
      message: `weight check not valid: ${result.problem ?? "no result"}`,
    };
  const rates = result.readers
    .map((entry) => `w${entry.weight} ${entry.rate?.iops ?? 0} IOPS`)
    .join(", ");
  if (result.ratio < WEIGHT_RATIO_FLOOR)
    return {
      level: "warn",
      device: null,
      message: `io.weight 100 vs 25 gave a ${result.ratio} ratio (${rates}): the weights have no effect`,
    };
  return {
    level: "ok",
    device: null,
    message: `io.weight 100 vs 25 gave a ${result.ratio} ratio (${rates})`,
  };
}
