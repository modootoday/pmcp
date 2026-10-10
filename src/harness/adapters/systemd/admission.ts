import { command } from "../process/command.js";
import { locateExecutable } from "../process/executable.js";

export const nativeHostTools = [
  "tmux",
  "flock",
  "systemctl",
  "systemd-run",
] as const;

export function assertNativeHost(): void {
  if (process.platform !== "linux")
    throw new Error("native_host_requires_linux");
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
