import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ArgumentError, type CommandContext } from "../../cli/command.js";
import type { Ui } from "../../cli/ui.js";
import {
  readFixtures,
  smoke,
  type SmokeResult,
} from "../../hooks/inspection/smoke.js";
import { configFrom } from "../config-from.js";

export function runSmoke(
  root: string,
  file: string,
  env: Readonly<Record<string, string | undefined>>,
): SmokeResult {
  let text: string;
  try {
    text = readFileSync(resolve(root, file), "utf8");
  } catch {
    throw new ArgumentError(`cannot read fixtures ${file}`);
  }
  try {
    return smoke(root, readFixtures(text), env);
  } catch (error) {
    throw new ArgumentError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function printSmoke(ui: Ui, result: SmokeResult): void {
  for (const finding of result.findings)
    ui.line(`  ✗ ${finding.where}: ${finding.message}`);
  ui.line(
    result.findings.length === 0
      ? `  ✓ ${result.cases} run(s) on ${result.runtimes.join(", ")}; ${result.guards.length} enforced guard(s) covered`
      : `  ✗ ${result.findings.length} finding(s) in ${result.cases} run(s)`,
  );
}

// pmcp hooks test --fixtures <file>: exit 0 all as expected, 1 any finding.
export async function run(
  context: CommandContext,
  file: string,
): Promise<number> {
  const config = configFrom(context);
  if (!config)
    throw new ArgumentError("no pmcp.toml here or above; pass --config");
  const result = runSmoke(config.dir, file, context.env);
  if (context.args.flags.has("json"))
    context.ui.data(JSON.stringify({ version: 1, ...result }) + "\n");
  else printSmoke(context.ui, result);
  return result.findings.length === 0 ? 0 : 1;
}
