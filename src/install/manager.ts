import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { InstallContext, PackageManager } from "./context.js";

export function installationCommand(
  context: InstallContext,
  specs: readonly string[],
) {
  if (context.manager === "npm") {
    const args = [
      "install",
      "--save-dev",
      "--save-exact",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ];
    if (context.project !== context.root)
      args.push(
        `--workspace=${relative(context.root, context.project).split(sep).join("/")}`,
      );
    return { executable: "npm", args: [...args, ...specs], cwd: context.root };
  }
  const args =
    context.manager === "pnpm"
      ? ["add", "--save-dev", "--save-exact", "--ignore-scripts"]
      : ["add", "--dev", "--exact", "--ignore-scripts"];
  if (
    context.manager === "pnpm" &&
    context.project === context.root &&
    existsSync(join(context.root, "pnpm-workspace.yaml"))
  )
    args.push("--workspace-root");
  return {
    executable: context.manager,
    args: [...args, ...specs],
    cwd: context.project,
  };
}

export function integrityArguments(
  manager: PackageManager,
  spec: string,
): string[] {
  const verb = manager === "bun" ? "info" : "view";
  return [verb, spec, "dist.integrity", "--json"];
}
