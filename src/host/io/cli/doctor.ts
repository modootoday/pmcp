import { EXIT, type CommandContext } from "../../../cli/command.js";
import { diagnose, weightFinding, type Finding } from "../doctor.js";
import type { CompareResult } from "../jobs.js";
import { readRecord, recordPath } from "../record.js";
import { liveCost, SYSFS } from "../sysfs.js";
import { leaseOf, linuxOnly, probeDir, seconds, underLease } from "./shared.js";
import { selfArgv } from "../jobs.js";
import { userManager } from "../../../lease/scope.js";

const COMPARE_MB = 512;

// Read-only unless --weights, which runs IO and so waits for the host lease like any heavy job.
export async function ioDoctor(context: CommandContext): Promise<number> {
  const refused = linuxOnly(context, "doctor");
  if (refused !== null) return refused;
  const lease = leaseOf(context);
  const live = liveCost(SYSFS);
  const json = context.args.flags.has("json");
  if (live.model === null || live.qos === null) {
    context.ui.error(
      "this kernel has no io.cost (cgroup v1, or blk-iocost not built in); io.weight cannot take effect",
    );
    return EXIT.missingOptional;
  }
  const record = readRecord(lease.dir);
  const findings: Finding[] = diagnose(record, live);
  let weights: CompareResult | null = null;
  if (context.args.flags.has("weights")) {
    const reason = userManager().unreachable(context.env);
    if (reason !== null) {
      weights = {
        valid: false,
        readers: [],
        ratio: null,
        problem: `no systemd user scope (${reason})`,
      };
    } else {
      const { code, result } = await underLease<CompareResult>(context, lease, {
        verb: "doctor",
        job: {
          kind: "compare",
          dir: probeDir(lease.dir),
          sizeMb: COMPARE_MB,
          seconds: seconds(context, 20),
          self: selfArgv(),
        },
        scoped: false,
      });
      if (result === null) return code === 0 ? EXIT.failure : code;
      weights = result;
    }
    findings.push(weightFinding(weights));
  }
  const warned = findings.some((finding) => finding.level === "warn");
  if (json) {
    context.ui.data(
      `${JSON.stringify({
        version: 1,
        record: recordPath(lease.dir),
        live_model: live.model,
        live_qos: live.qos,
        findings,
        ...(weights ? { weights } : {}),
      })}\n`,
    );
  } else {
    context.ui.results.records(
      findings.map(
        (finding) =>
          `${finding.level === "ok" ? "ok  " : "WARN"}  ${finding.device ?? "-"}  ${finding.message}`,
      ),
    );
  }
  return warned ? EXIT.differences : EXIT.ok;
}
