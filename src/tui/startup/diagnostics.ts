import { dependencies } from "../adapters/process/runtime.js";
import { assertNativeHost } from "../../harness/adapters/systemd/admission.js";
import { runtimeExecutables } from "../../harness/runtimes/registry.js";
import { locateExecutable } from "../../harness/adapters/process/executable.js";
import type { Receipt } from "../../harness/contracts.js";

function remediation(
  tools: ReturnType<typeof dependencies>,
  userManagerAvailable: boolean,
): string[] {
  const steps: string[] = [];
  if (tools.platform !== "linux")
    steps.push(
      "Use a qualified Linux host for the terminal workspace. Other PMCP CLI features do not require this host profile.",
    );
  const missing = ["tmux", "flock", "systemctl", "systemdRun"].filter(
    (name) => !tools[name as keyof typeof tools],
  );
  if (missing.length)
    steps.push(
      `Install the missing tmux, util-linux or systemd tools for your distribution and add them to PATH: ${missing.join(", ")}.`,
    );
  if (!tools.nodeSupported)
    steps.push(
      "Select Node.js 22 or later through your existing version manager and check node --version in this terminal.",
    );
  if (tools.supported && !userManagerAvailable)
    steps.push(
      "Check systemctl --user status in your login session and restore access to its user manager before launching. Doctor does not start or repair services.",
    );
  return steps;
}

export function inspectTerminalHost(): Receipt {
  const tools = dependencies();
  let userManagerAvailable = false;
  let reason: string | undefined;
  try {
    if (!tools.supported) throw new Error("tui_dependencies_unavailable");
    assertNativeHost();
    userManagerAvailable = true;
  } catch (error) {
    reason = error instanceof Error ? error.message : "native_host_unavailable";
  }
  const runtimes = Object.entries(runtimeExecutables).map(
    ([id, executable]) => {
      const path = locateExecutable(executable);
      return {
        id,
        executable,
        installed: Boolean(path),
        ...(path ? { path } : {}),
        nativeAcceptance: "not-assessed",
        authentication: "not-inspected",
      };
    },
  );
  return {
    schemaVersion: 1,
    ok: true,
    ...tools,
    supported: tools.supported && userManagerAvailable,
    userManagerAvailable,
    ...(reason ? { reason } : {}),
    runtimes,
    qualification:
      "Prerequisite availability only; native behavior and cgroup delegation require separate qualification.",
    remediation: remediation(tools, userManagerAvailable),
    nextCommands: ["pmcp tui plan", "pmcp tui recovery"],
    providerInvoked: false,
    authenticationInspected: false,
  };
}
