import type { Command } from "../cli/command.js";
import {
  validateCatalog,
  validateSkillDir,
  type Finding,
} from "../validate.js";

import { catalogOptionsFrom, configFrom } from "./roots.js";
import { validateSpec } from "./specs/catalog.js";

export const validateCommand: Command = {
  ...validateSpec,
  run(context) {
    const dirs = context.args.positional;
    const settings = configFrom(context)?.catalog.validation ?? {};
    const findings: Finding[] =
      dirs.length > 0
        ? dirs.flatMap((dir) => validateSkillDir(dir, settings))
        : validateCatalog(catalogOptionsFrom(context), settings);
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
