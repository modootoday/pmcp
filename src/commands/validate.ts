import type { Command } from "../cli/command.js";
import {
  validateCatalog,
  validateSkillDir,
  type Finding,
} from "../validate.js";

import { CATALOG_OPTIONS, catalogOptionsFrom } from "./roots.js";

export const validateCommand: Command = {
  name: "validate",
  describe:
    "Check skills against the Agent Skills specification: given directories, or every skill the catalog reaches",
  usage:
    "pmcp validate [<skill-dir>...] [--root <dir>] [--marketplace <dir>] [--package <dir>] [--workspace <dir>] [--config <file> | --no-config] [--json]",
  options: [
    ...CATALOG_OPTIONS,
    { name: "json", describe: "Emit JSON rather than a table.", boolean: true },
  ],
  run(context) {
    const dirs = context.args.positional;
    const findings: Finding[] =
      dirs.length > 0
        ? dirs.flatMap(validateSkillDir)
        : validateCatalog(catalogOptionsFrom(context));
    const errors = findings.filter((f) => f.level === "error").length;

    if (context.args.flags.has("json")) {
      context.ui.data(`${JSON.stringify({ findings }, null, 2)}\n`);
      return errors > 0 ? 1 : 0;
    }
    for (const finding of findings) {
      const report =
        finding.level === "error" ? context.ui.error : context.ui.warn;
      report.call(context.ui, finding.reason, finding.path);
    }
    if (findings.length === 0) context.ui.success("every skill is valid");
    return errors > 0 ? 1 : 0;
  },
};
