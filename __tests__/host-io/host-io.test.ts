import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  diagnose,
  measureRefusal,
  weightFinding,
} from "../../src/host/io/doctor.js";
import { judgeCompare, type ReaderResult } from "../../src/host/io/jobs.js";
import { modelLine, qosLine, type IoModel } from "../../src/host/io/model.js";
import { ioPlan, planText } from "../../src/host/io/plan.js";
import { modelOf, type Rate } from "../../src/host/io/probe.js";
import {
  readRecord,
  recordPath,
  writeRecord,
  type DeviceRecord,
} from "../../src/host/io/record.js";
import { ioGaps, liveCost, wholeDisk } from "../../src/host/io/sysfs.js";

const MODEL: IoModel = {
  rbps: 274768515,
  rseqiops: 3143,
  rrandiops: 2747,
  wbps: 298313924,
  wseqiops: 2782,
  wrandiops: 2615,
};
const MODEL_LINE =
  "259:0 ctrl=user model=linear rbps=274768515 rseqiops=3143 rrandiops=2747 wbps=298313924 wseqiops=2782 wrandiops=2615";
const QOS_LINE =
  "259:0 enable=1 ctrl=user rpct=0 rlat=0 wpct=0 wlat=0 min=50 max=100";
const LIVE_QOS =
  "259:0 enable=1 ctrl=user rpct=0.00 rlat=0 wpct=0.00 wlat=0 min=50.00 max=100.00\n";
const AUTO_QOS =
  "259:0 enable=1 ctrl=auto rpct=0.00 rlat=25000 wpct=0.00 wlat=25000 min=1.00 max=10000.00\n";

const made: string[] = [];
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-hostio-"));
  made.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of made.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function entry(overrides: Partial<DeviceRecord> = {}): DeviceRecord {
  return {
    device: "259:0",
    measured_at: "2026-11-09T19:53:00.000Z",
    pmcp: "0.27.0",
    dir: "/var/tmp",
    seconds: 8,
    size_mb: 1024,
    model: MODEL,
    probes: {},
    live_model: null,
    live_qos: null,
    ...overrides,
  };
}

function sysfs(model: string | null, qos: string | null): string {
  const sys = temp();
  const cgroup = join(sys, "fs", "cgroup");
  mkdirSync(cgroup, { recursive: true });
  if (model !== null) writeFileSync(join(cgroup, "io.cost.model"), model);
  if (qos !== null) writeFileSync(join(cgroup, "io.cost.qos"), qos);
  return sys;
}

describe("io record", () => {
  it("writes and reads a record per device, keeping other devices", () => {
    const dir = join(temp(), "lease");
    expect(readRecord(dir)).toBeNull();
    writeRecord(dir, entry());
    writeRecord(dir, entry({ device: "259:4" }));
    const record = readRecord(dir);
    expect(Object.keys(record!.devices).sort()).toEqual(["259:0", "259:4"]);
    expect(record!.devices["259:0"]!.model).toEqual(MODEL);
    expect(recordPath(dir)).toBe(join(dir, "io-model.json"));
  });

  it("refuses a record whose model is incomplete instead of replacing it", () => {
    const dir = temp();
    writeFileSync(
      recordPath(dir),
      JSON.stringify({
        version: 1,
        devices: { "259:0": { device: "259:0", model: { rbps: 1 } } },
      }),
    );
    expect(() => readRecord(dir)).toThrow(/no valid model/u);
    expect(() => writeRecord(dir, entry())).toThrow(/no valid model/u);
  });
});

describe("io plan", () => {
  it("prints the model line, the capped qos line and a unit of its own", () => {
    expect(modelLine("259:0", MODEL)).toBe(MODEL_LINE);
    expect(qosLine("259:0")).toBe(QOS_LINE);
    const text = planText(
      ioPlan({ version: 1, devices: { "259:0": entry() } }),
    );
    expect(text.split("\n")).toEqual([
      "# 259:0, measured 2026-11-09T19:53:00.000Z by pmcp 0.27.0",
      "# /sys/fs/cgroup/io.cost.model",
      MODEL_LINE,
      "# /sys/fs/cgroup/io.cost.qos",
      QOS_LINE,
      "",
      "# /etc/systemd/system/pmcp-io-cost.service",
      "[Unit]",
      "Description=io.cost model measured by pmcp host io measure",
      "After=local-fs.target",
      "",
      "[Service]",
      "Type=oneshot",
      "RemainAfterExit=yes",
      `ExecStart=/bin/sh -c "echo '${MODEL_LINE}' > /sys/fs/cgroup/io.cost.model"`,
      `ExecStart=/bin/sh -c "echo '${QOS_LINE}' > /sys/fs/cgroup/io.cost.qos"`,
      "",
      "[Install]",
      "WantedBy=multi-user.target",
      "",
      "# install it as root, then: systemctl daemon-reload && systemctl enable --now pmcp-io-cost.service",
      "",
    ]);
  });

  it("prints a drop-in for a named oneshot unit", () => {
    const plan = ioPlan(
      { version: 1, devices: { "259:0": entry() } },
      "iocost.service",
    );
    expect(plan.unit.path).toBe(
      "/etc/systemd/system/iocost.service.d/pmcp-io-model.conf",
    );
    expect(plan.unit.text.split("\n")).toEqual([
      "[Service]",
      `ExecStart=/bin/sh -c "echo '${MODEL_LINE}' > /sys/fs/cgroup/io.cost.model"`,
      `ExecStart=/bin/sh -c "echo '${QOS_LINE}' > /sys/fs/cgroup/io.cost.qos"`,
      "",
    ]);
    expect(plan.apply).toBe(
      "systemctl daemon-reload && systemctl restart iocost.service",
    );
  });
});

describe("io doctor", () => {
  const record = { version: 1 as const, devices: { "259:0": entry() } };

  it("passes when the live model and qos match the record", () => {
    const live = liveCost(sysfs(`${MODEL_LINE}\n`, LIVE_QOS));
    const findings = diagnose(record, live);
    expect(findings.map((finding) => finding.level)).toEqual(["ok", "ok"]);
  });

  it("warns when there is no record", () => {
    const live = liveCost(sysfs(`${MODEL_LINE}\n`, LIVE_QOS));
    expect(diagnose(null, live)).toEqual([
      {
        level: "warn",
        device: null,
        message: "no io model recorded; run pmcp host io measure",
      },
    ]);
  });

  it("warns on the kernel's own model and names each differing field", () => {
    const auto =
      "259:0 ctrl=auto model=linear rbps=488636629 rseqiops=8932 rrandiops=8518 wbps=427891549 wseqiops=28755 wrandiops=21940\n";
    const findings = diagnose(record, liveCost(sysfs(auto, LIVE_QOS)));
    const warned = findings.filter((finding) => finding.level === "warn");
    expect(warned.map((finding) => finding.message)).toEqual([
      "io.cost.model ctrl=auto: the kernel's own estimate is in use, not the recorded model",
      "io.cost.model differs from the record: rbps live 488636629, recorded 274768515; rseqiops live 8932, recorded 3143; rrandiops live 8518, recorded 2747; wbps live 427891549, recorded 298313924; wseqiops live 28755, recorded 2782; wrandiops live 21940, recorded 2615",
    ]);
  });

  it("warns when qos lets vrate outrun the model", () => {
    const findings = diagnose(
      record,
      liveCost(sysfs(`${MODEL_LINE}\n`, AUTO_QOS)),
    );
    expect(
      findings
        .filter((finding) => finding.level === "warn")
        .map((finding) => finding.message),
    ).toEqual([
      "io.cost.qos ctrl=auto: the kernel moves vrate itself and may run far past the model",
      "io.cost.qos max=10000.00 exceeds 100: vrate can outrun the model",
    ]);
    const raised = diagnose(
      record,
      liveCost(
        sysfs(`${MODEL_LINE}\n`, LIVE_QOS.replace("max=100.00", "max=150.00")),
      ),
    );
    expect(raised.filter((finding) => finding.level === "warn")).toHaveLength(
      1,
    );
  });

  it("warns when the device is missing from the live files", () => {
    const findings = diagnose(record, liveCost(sysfs("", "")));
    expect(findings.map((finding) => finding.message)).toEqual([
      "the kernel has no io.cost model for 259:0",
      "the kernel has no io.cost qos for 259:0",
    ]);
  });

  it("reads no io.cost on a kernel without the files", () => {
    expect(liveCost(sysfs(null, null))).toEqual({ model: null, qos: null });
  });
});

describe("measure gate", () => {
  it("refuses while qos is ctrl=user and names the line that lifts the cap", () => {
    const live = liveCost(sysfs(`${MODEL_LINE}\n`, LIVE_QOS));
    expect(measureRefusal(live, "259:0")).toEqual([
      "io.cost.qos on 259:0 is ctrl=user, so vrate is held to the current model and a probe would measure that cap",
      "lift the cap for the measurement as root: echo '259:0 enable=1 ctrl=auto' > /sys/fs/cgroup/io.cost.qos",
      "afterwards pmcp host io plan prints the capped qos line to restore",
    ]);
  });

  it("lets the measurement go on to the lease under ctrl=auto", () => {
    const live = liveCost(sysfs(`${MODEL_LINE}\n`, AUTO_QOS));
    expect(measureRefusal(live, "259:0")).toBeNull();
  });
});

describe("weight check", () => {
  const MANAGER = "user.slice/user-1000.slice/user@1000.service";
  const SCOPE = `/${MANAGER}/pmcp.slice/pmcp-io.slice/check-w25.scope`;

  function tree(withoutIo: readonly string[]): string {
    const root = temp();
    const dirs = [
      "",
      "user.slice",
      "user.slice/user-1000.slice",
      MANAGER,
      `${MANAGER}/pmcp.slice`,
      `${MANAGER}/pmcp.slice/pmcp-io.slice`,
    ];
    for (const dir of dirs) {
      mkdirSync(join(root, dir), { recursive: true });
      const io = withoutIo.includes(dir) ? "" : "io ";
      writeFileSync(
        join(root, dir, "cgroup.subtree_control"),
        `${io}memory pids\n`,
      );
    }
    return root;
  }

  it("finds every ancestor whose subtree_control lacks io", () => {
    expect(ioGaps(tree([]), SCOPE)).toEqual([]);
    expect(ioGaps(tree([`${MANAGER}/pmcp.slice`, ""]), SCOPE)).toEqual([
      "/",
      `/${MANAGER}/pmcp.slice`,
    ]);
  });

  function reader(
    weight: number,
    iops: number,
    gaps: string[] = [],
  ): ReaderResult {
    return {
      weight,
      cgroup: `/x/w${weight}.scope`,
      gaps,
      weightSet: true,
      rate: { ops: iops * 20, seconds: 20, iops, bps: iops * 4096 },
    };
  }

  it("judges the comparison invalid before reading any ratio when io is missing above a scope", () => {
    const result = judgeCompare([
      reader(25, 1500, ["/a.slice"]),
      reader(100, 1500),
    ]);
    expect(result.valid).toBe(false);
    expect(weightFinding(result).message).toBe(
      "weight check not valid: io is not enabled in cgroup.subtree_control of /a.slice",
    );
  });

  it("warns at the measured 1.05 ratio and passes at 4.00", () => {
    const flat = judgeCompare([reader(25, 1503), reader(100, 1582)]);
    expect(flat.ratio).toBe(1.05);
    expect(weightFinding(flat).level).toBe("warn");
    const working = judgeCompare([reader(25, 277), reader(100, 1108)]);
    expect(working.ratio).toBe(4);
    expect(weightFinding(working)).toEqual({
      level: "ok",
      device: null,
      message:
        "io.weight 100 vs 25 gave a 4 ratio (w25 277 IOPS, w100 1108 IOPS)",
    });
  });
});

describe("probe model", () => {
  const rate = (iops: number, bps: number): Rate => ({
    ops: iops,
    seconds: 1,
    iops,
    bps,
  });

  it("maps the probes onto the model fields the baseline used", () => {
    expect(
      modelOf({
        wseq_1m_file: rate(284, 298313924),
        rseq_1m_qd4: rate(262, 274768515),
        rseq_4k_qd16: rate(3143, 0),
        rrand_4k_qd16: rate(2747, 0),
        wseq_4k_qd16: rate(2782, 0),
        wrand_4k_qd16: rate(2615, 0),
      }),
    ).toEqual(MODEL);
  });

  it("refuses a probe that measured nothing", () => {
    expect(() => modelOf({ wseq_1m_file: rate(0, 0) })).toThrow(/gave no/u);
  });
});

describe("whole disk", () => {
  it("resolves a partition to the disk that holds it", () => {
    const sys = temp();
    const disk = join(sys, "devices", "nvme0n1");
    mkdirSync(join(disk, "nvme0n1p1"), { recursive: true });
    writeFileSync(join(disk, "dev"), "259:0\n");
    writeFileSync(join(disk, "nvme0n1p1", "partition"), "1\n");
    mkdirSync(join(sys, "dev", "block"), { recursive: true });
    symlinkSync(join(disk, "nvme0n1p1"), join(sys, "dev", "block", "259:1"));
    symlinkSync(disk, join(sys, "dev", "block", "259:0"));
    expect(wholeDisk(sys, "259:1")).toBe("259:0");
    expect(wholeDisk(sys, "259:0")).toBe("259:0");
    expect(readFileSync(join(disk, "dev"), "utf8").trim()).toBe("259:0");
  });
});
