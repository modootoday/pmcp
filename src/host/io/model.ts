// The io.cost lines pmcp records and prints. The kernel's own estimate (ctrl=auto) can overstate a
// network volume several times, and qos ctrl=auto lets vrate rise far above any model, so a
// measured model only takes effect with the qos cap that comes with it.

export interface IoModel {
  readonly rbps: number;
  readonly rseqiops: number;
  readonly rrandiops: number;
  readonly wbps: number;
  readonly wseqiops: number;
  readonly wrandiops: number;
}

export const MODEL_KEYS: readonly (keyof IoModel)[] = [
  "rbps",
  "rseqiops",
  "rrandiops",
  "wbps",
  "wseqiops",
  "wrandiops",
];

export const QOS =
  "enable=1 ctrl=user rpct=0 rlat=0 wpct=0 wlat=0 min=50 max=100";

export function modelLine(device: string, model: IoModel): string {
  const fields = MODEL_KEYS.map((key) => `${key}=${model[key]}`).join(" ");
  return `${device} ctrl=user model=linear ${fields}`;
}

export function qosLine(device: string): string {
  return `${device} ${QOS}`;
}

// One line of io.cost.model or io.cost.qos: the device, then key=value fields.
export interface CostLine {
  readonly device: string;
  readonly fields: Readonly<Record<string, string>>;
}

export function parseCostLines(text: string): CostLine[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const [device = "", ...pairs] = line.split(/\s+/u);
      const fields: Record<string, string> = {};
      for (const pair of pairs) {
        const at = pair.indexOf("=");
        if (at > 0) fields[pair.slice(0, at)] = pair.slice(at + 1);
      }
      return { device, fields };
    });
}

export const SYSTEMD_UNIT = "pmcp-io-cost.service";

function execLines(device: string, model: IoModel): string[] {
  const write = (line: string, file: string) =>
    `ExecStart=/bin/sh -c "echo '${line}' > /sys/fs/cgroup/${file}"`;
  return [
    write(modelLine(device, model), "io.cost.model"),
    write(qosLine(device), "io.cost.qos"),
  ];
}

export interface UnitFile {
  readonly path: string;
  readonly text: string;
}

// A drop-in adds ExecStart lines, which only a oneshot unit accepts; without one, a unit of its own.
export function systemdUnit(
  devices: readonly { device: string; model: IoModel }[],
  dropInFor?: string,
): UnitFile {
  const exec = devices.flatMap(({ device, model }) => execLines(device, model));
  if (dropInFor !== undefined)
    return {
      path: `/etc/systemd/system/${dropInFor}.d/pmcp-io-model.conf`,
      text: ["[Service]", ...exec, ""].join("\n"),
    };
  return {
    path: `/etc/systemd/system/${SYSTEMD_UNIT}`,
    text: [
      "[Unit]",
      "Description=io.cost model measured by pmcp host io measure",
      "After=local-fs.target",
      "",
      "[Service]",
      "Type=oneshot",
      "RemainAfterExit=yes",
      ...exec,
      "",
      "[Install]",
      "WantedBy=multi-user.target",
      "",
    ].join("\n"),
  };
}
