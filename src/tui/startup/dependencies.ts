import { locateExecutable } from "../../harness/adapters/process/executable.js";
import { command } from "../../harness/adapters/process/command.js";
import { ptyBinary } from "../../project/host.js";
import { tuiBinary } from "../rust.js";

// What the workspace needs: pmcp-pty and pmcp-tui everywhere, Node 22 for the CLI, and the
// systemd tools on Linux, where sessions are memory-capped. macOS runs without caps.
export function dependencies() {
  const node = locateExecutable("node");
  const linux = process.platform === "linux";
  const systemctl = linux ? locateExecutable("systemctl") : null;
  const systemdRun = linux ? locateExecutable("systemd-run") : null;
  let nodeSupported = false;
  if (node) {
    try {
      nodeSupported =
        Number(
          command(node, ["--version"]).trim().replace(/^v/, "").split(".")[0],
        ) >= 22;
    } catch {}
  }
  const pty = ptyBinary(process.env);
  const tui = tuiBinary();
  const platformSupported = linux || process.platform === "darwin";
  return {
    platform: process.platform,
    node,
    nodeSupported,
    pmcpPty: pty,
    pmcpTui: tui,
    systemctl,
    systemdRun,
    memoryCapped: linux,
    supported:
      platformSupported &&
      Boolean(pty && tui && nodeSupported) &&
      (!linux || Boolean(systemctl && systemdRun)),
  };
}
