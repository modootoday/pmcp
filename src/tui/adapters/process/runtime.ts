import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, realpathSync } from "node:fs";
import { locateExecutable } from "../../../harness/adapters/process/executable.js";
import { command } from "../../../harness/adapters/process/command.js";
import { assertNativeHost } from "../../../harness/adapters/systemd/admission.js";

export function dependencies() {
  const tmux = locateExecutable("tmux");
  const flock = locateExecutable("flock");
  const node = locateExecutable("node");
  const systemctl = locateExecutable("systemctl");
  const systemdRun = locateExecutable("systemd-run");
  let nodeSupported = false;
  if (node) {
    try {
      nodeSupported =
        Number(
          command(node, ["--version"]).trim().replace(/^v/, "").split(".")[0],
        ) >= 22;
    } catch {}
  }
  return {
    platform: process.platform,
    tmux,
    flock,
    node,
    nodeSupported,
    systemctl,
    systemdRun,
    supported:
      process.platform === "linux" &&
      Boolean(tmux && flock && nodeSupported && systemctl && systemdRun),
  };
}

export function runtime(): { node: string; worker: string } {
  assertNativeHost();
  const available = dependencies();
  if (!available.supported || !available.node)
    throw new Error("tui_dependencies_unavailable");
  const current = fileURLToPath(import.meta.url);
  const directory = dirname(current);
  const bundled = join(directory, "tui-worker.js");
  if (!existsSync(bundled)) throw new Error("tui_build_required");
  return { node: realpathSync(available.node), worker: bundled };
}
