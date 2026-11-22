import { spawn } from "node:child_process";
import { ptyBinary } from "../../native/binary.js";
import { ptyRequest } from "../adapters/pty/client.js";
import { historyLaunch } from "./open-history.js";

export async function openWakeableCodex(
  archive: string,
  socket: string,
  model?: string,
): Promise<number> {
  if (!process.stdin.isTTY) throw new Error("history_attach_requires_terminal");
  const binary = ptyBinary(process.env);
  if (!binary) throw new Error("terminal_host_missing");
  const launch = await historyLaunch("codex", archive);
  const reply = await ptyRequest(
    socket,
    {
      op: "spawn",
      argv: [
        launch.executable,
        ...(model ? ["--model", model] : []),
        "--no-alt-screen",
        "--sandbox",
        "workspace-write",
        "--ask-for-approval",
        "on-request",
        ...launch.args,
      ],
      cwd: launch.cwd,
      profile: "codex",
      delivery_setup: true,
    },
    30_000,
  );
  if (reply["ok"] !== true || typeof reply["id"] !== "string") {
    throw new Error(
      `history_terminal_start_failed: ${String(reply["code"] ?? "unknown")}`,
    );
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      binary,
      ["attach", reply["id"] as string, "--socket", socket],
      {
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
