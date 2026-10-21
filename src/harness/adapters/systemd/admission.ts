import { ptyBinary } from "../../../project/host.js";
import { command } from "../process/command.js";
import { locateExecutable } from "../process/executable.js";

// Sessions run in the group's pmcp-pty daemon everywhere; Linux also caps each one in a systemd
// scope inside the group's slice. macOS has no equivalent: groups run uncapped there, with the
// session count still enforced.
export const nativeHostTools = ["systemctl", "systemd-run"] as const;

export function assertNativeHost(): void {
  if (process.platform !== "linux" && process.platform !== "darwin")
    throw new Error("native_host_requires_linux_or_macos");
  if (!ptyBinary(process.env))
    throw new Error("native_host_tool_unavailable:pmcp-pty");
  if (process.platform !== "linux") return;
  for (const executable of nativeHostTools) {
    if (!locateExecutable(executable))
      throw new Error(`native_host_tool_unavailable:${executable}`);
  }
  try {
    const version = command(
      "systemctl",
      ["--user", "show", "--property=Version", "--value"],
      { timeout: 5_000 },
    );
    if (!version.trim()) throw new Error("empty_user_manager_version");
  } catch {
    throw new Error("native_user_manager_unavailable");
  }
}
