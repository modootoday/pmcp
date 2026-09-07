import { spawnSync } from "node:child_process";
import { readInstalledDependencies } from "../installed.js";
import { fingerprint, type InstallPlan } from "./plan.js";

export interface PackageManagerRunner {
  integrity(packageSpec: string, plan: InstallPlan): string;
  install(plan: InstallPlan): number;
}

function environment(
  userConfig: string | undefined,
  base: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return userConfig
    ? {
        ...base,
        NPM_CONFIG_USERCONFIG: userConfig,
        npm_config_userconfig: userConfig,
      }
    : base;
}

export function createPackageManagerRunner(
  userConfig?: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
  verifiedIntegrity?: ReadonlyMap<string, string>,
): PackageManagerRunner {
  return {
    integrity(packageSpec, plan) {
      const alreadyVerified = verifiedIntegrity?.get(packageSpec);
      if (alreadyVerified) return alreadyVerified;
      const { manager, project } = plan.context;
      const args =
        manager === "npm"
          ? ["view", packageSpec, "dist.integrity", "--json"]
          : ["info", packageSpec, "dist.integrity", "--json"];
      const result = spawnSync(manager, args, {
        cwd: project,
        env: environment(userConfig, baseEnv),
        encoding: "utf8",
        shell: false,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      });
      if (result.error || result.status !== 0) {
        const detail = `${result.error?.message ?? ""} ${result.stderr ?? ""}`
          .replace(/pmcp_[A-Za-z0-9_-]{43}/gu, "[redacted]")
          .trim()
          .slice(0, 300);
        throw new Error(
          `package manager could not verify registry integrity${detail ? `: ${detail}` : ""}`,
        );
      }
      const value: unknown = JSON.parse(result.stdout.trim());
      if (typeof value !== "string")
        throw new Error("registry returned no package integrity");
      return value;
    },
    install(plan) {
      const args = [...plan.command.args];
      const result = spawnSync(plan.command.executable, args, {
        cwd: plan.command.cwd,
        env: environment(userConfig, baseEnv),
        stdio: ["inherit", "pipe", "pipe"],
        encoding: "utf8",
        shell: false,
        maxBuffer: 8 * 1024 * 1024,
      });
      if (result.error)
        throw new Error(
          "package manager execution failed; inspect the project before retrying",
        );
      if (result.stdout) process.stderr.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      return result.status ?? 1;
    },
  };
}

export const packageManagerRunner = createPackageManagerRunner();

export function applyInstallPlan(
  plan: InstallPlan,
  runner: PackageManagerRunner = packageManagerRunner,
): number {
  if (!plan.changes.length) return 0;
  if (fingerprint(plan.context.files) !== plan.context.fingerprint)
    throw new Error("project changed after planning; create a new plan");
  for (const entry of plan.changes) {
    const integrity = runner.integrity(
      `${entry.packageName}@${entry.version}`,
      plan,
    );
    if (integrity !== entry.integrity)
      throw new Error(
        "registry integrity differs from the catalog; nothing was installed",
      );
  }
  // Registry reads may take long enough for another editor to change the project.
  if (fingerprint(plan.context.files) !== plan.context.fingerprint)
    throw new Error("project changed during registry verification");
  const code = runner.install(plan);
  if (code !== 0) return code;
  const after = readInstalledDependencies(plan.context.project);
  for (const entry of plan.changes) {
    const found = after.dependencies.find(
      (dependency) => dependency.requestedAs === entry.packageName,
    );
    if (
      !found ||
      found.name !== entry.packageName ||
      found.version !== entry.version
    ) {
      throw new Error(
        "package manager exited successfully but the planned version is not installed",
      );
    }
  }
  return 0;
}
