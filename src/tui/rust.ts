import { spawn } from "node:child_process";
import { nativeBinary } from "../native/binary.js";

// pmcp tui is the Rust pmcp-tui (crates/pmcp-tui): PMCP_TUI_BIN when set, else the platform
// package, else pmcp-tui on PATH.
export function tuiBinary(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  return nativeBinary("pmcp-tui", "PMCP_TUI_BIN", env);
}

export const TUI_MISSING =
  "tui_binary_missing: set PMCP_TUI_BIN to the pmcp-tui binary (cargo build --release in crates/pmcp-tui gives crates/pmcp-tui/target/release/pmcp-tui) or put pmcp-tui on PATH";

/** Runs the workspace on the group's pmcp-pty socket with main shown first, until it exits. */
export async function runTui(socket: string, main: string): Promise<number> {
  const binary = tuiBinary();
  if (!binary) throw new Error(TUI_MISSING);
  const child = spawn(binary, ["--socket", socket, "--main", main], {
    stdio: "inherit",
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
