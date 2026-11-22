import { spawn } from "node:child_process";
import { ptyBinary } from "../../native/binary.js";
import { codexMailboxRoots } from "../../sessions/mailbox/codex-access.js";
import { stateHome } from "../../sessions/state-dir.js";
import { ptyRequest } from "../adapters/pty/client.js";
import { codexConfiguredRoots } from "./codex-config.js";
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
  const mailboxRoots = await codexMailboxRoots(launch.cwd, process.env);
  const writableRoots = mailboxRoots.length
    ? [
        ...new Set([
          ...(await codexConfiguredRoots(launch.executable, launch.cwd)),
          ...mailboxRoots,
        ]),
      ]
    : [];
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
      env: { XDG_STATE_HOME: stateHome(process.env) },
      profile: "codex",
      delivery_setup: true,
      codex_writable_roots: writableRoots,
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
