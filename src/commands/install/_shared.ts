import type { CommandContext } from "../../cli/command.js";
import { verifyInstalledContent } from "../../install/verify-content.js";
import type { InstallOperation } from "./types.js";

export function verification(
  context: CommandContext,
  project: string,
  digests: ReadonlyMap<string, string>,
): Pick<InstallOperation, "mismatched" | "reportMismatch"> {
  const mismatched = (packages: readonly string[]) =>
    packages
      .map((name) =>
        verifyInstalledContent(project, name, digests.get(name) ?? ""),
      )
      .filter((check) => !check.matched);

  const reportMismatch = (checks: ReturnType<typeof mismatched>) => {
    for (const check of checks) {
      context.ui.error(
        "installed content does not match the catalog",
        `${check.packageName}: expected ${check.expected}, found ${check.actual} across ${check.skillCount} skill files`,
      );
    }
  };

  return { mismatched, reportMismatch };
}
