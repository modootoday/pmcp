import { homedir } from "node:os";

import { ArgumentError, many, type Command } from "../cli/command.js";
import { doctor, spawnRunner, type Finding } from "../project/doctor.js";
import { featureRows } from "../project/features.js";
import { memoryFindings } from "../project/memory.js";
import { TOOLS, type Tool } from "../project/tools.js";
import { specFrom } from "./project/spec-from.js";
import { printFeatures } from "./doctor/features.js";
import { doctorSpec } from "./specs/project.js";

const MARKS: Record<Finding["status"], string> = {
  ok: "ok",
  fail: "FAIL",
  warn: "warn",
  skip: "skip",
};

export const doctorCommand: Command = {
  ...doctorSpec,
  run(context) {
    const only = many(context.args, "tool");
    for (const tool of only) {
      if (!(TOOLS as readonly string[]).includes(tool))
        throw new ArgumentError(`unknown tool ${tool}`);
    }
    const options = {
      run: spawnRunner,
      home: context.env["HOME"] ?? homedir(),
      env: context.env,
      ...(only.length > 0 ? { only: new Set(only as Tool[]) } : {}),
    };
    const spec = specFrom(context);
    const findings = context.args.flags.has("memory")
      ? memoryFindings(spec, options)
      : doctor(spec, options);
    // Limit the feature table to hook-enabled projects to preserve older doctor output.
    const features = spec.hookBundle ? featureRows(spec, options) : [];
    if (context.args.flags.has("json")) {
      const extra = features.length > 0 ? { features } : {};
      context.ui.data(`${JSON.stringify({ findings, ...extra }, null, 2)}\n`);
    } else {
      context.ui.table(
        findings.map((f) => [
          `${MARKS[f.status]}  ${f.tool}`,
          f.detail ? `${f.check} (${f.detail})` : f.check,
        ]),
      );
      printFeatures(context.ui, features);
    }
    return findings.some((f) => f.status === "fail") ? 1 : 0;
  },
};
