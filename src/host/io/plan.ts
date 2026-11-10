import { modelLine, qosLine, systemdUnit, type UnitFile } from "./model.js";
import type { IoRecord } from "./record.js";

export interface IoPlan {
  readonly devices: readonly {
    readonly device: string;
    readonly measured_at: string;
    readonly pmcp: string;
    readonly model_line: string;
    readonly qos_line: string;
  }[];
  readonly unit: UnitFile;
  readonly apply: string;
}

export function ioPlan(record: IoRecord, dropInFor?: string): IoPlan {
  const entries = Object.values(record.devices).sort((a, b) =>
    a.device.localeCompare(b.device),
  );
  const unit = systemdUnit(entries, dropInFor);
  const apply =
    dropInFor === undefined
      ? `systemctl daemon-reload && systemctl enable --now ${unit.path.slice(unit.path.lastIndexOf("/") + 1)}`
      : `systemctl daemon-reload && systemctl restart ${dropInFor}`;
  return {
    devices: entries.map((entry) => ({
      device: entry.device,
      measured_at: entry.measured_at,
      pmcp: entry.pmcp,
      model_line: modelLine(entry.device, entry.model),
      qos_line: qosLine(entry.device),
    })),
    unit,
    apply,
  };
}

export function planText(plan: IoPlan): string {
  const lines: string[] = [];
  for (const entry of plan.devices)
    lines.push(
      `# ${entry.device}, measured ${entry.measured_at} by pmcp ${entry.pmcp}`,
      "# /sys/fs/cgroup/io.cost.model",
      entry.model_line,
      "# /sys/fs/cgroup/io.cost.qos",
      entry.qos_line,
      "",
    );
  lines.push(
    `# ${plan.unit.path}`,
    plan.unit.text.trimEnd(),
    "",
    `# install it as root, then: ${plan.apply}`,
  );
  return `${lines.join("\n")}\n`;
}
