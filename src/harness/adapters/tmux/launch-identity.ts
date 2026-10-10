import type { Connection } from "./connection.js";
import { processIdentity } from "../process/identity.js";
import { integer, text } from "../../validation.js";
import type { LaunchIntent, LaunchProof } from "../../launch/contracts.js";

export function createProof(
  connection: Connection,
  intent: LaunchIntent,
): LaunchProof {
  const paneId = text(process.env.TMUX_PANE, "native_pane");
  if (!/^%\d+$/.test(paneId)) throw new Error("invalid_native_pane");
  const socket = text(process.env.TMUX, "native_tmux").split(",")[0];
  if (socket !== intent.socket) throw new Error("foreign_native_socket");
  connection.tmux([
    "set-option",
    "-p",
    "-t",
    paneId,
    "@pmcp-owner",
    intent.owner,
  ]);
  connection.tmux([
    "set-option",
    "-p",
    "-t",
    paneId,
    "@pmcp-session",
    intent.id,
  ]);
  connection.tmux([
    "set-option",
    "-p",
    "-t",
    paneId,
    "@pmcp-launch",
    intent.nonce,
  ]);
  const fields = connection
    .tmux([
      "display-message",
      "-p",
      "-t",
      paneId,
      "#{session_id}|#{window_id}|#{pane_id}|#{pane_pid}|#{pid}",
    ])
    .trim()
    .split("|");
  return {
    nonce: intent.nonce,
    runnerIdentity: processIdentity(process.pid),
    session: {
      id: intent.id,
      owner: intent.owner,
      socket: intent.socket,
      runtime: intent.runtime,
      cwd: intent.cwd,
      memoryMb: intent.memoryMb,
      tmuxSessionId: text(fields[0], "session"),
      windowId: text(fields[1], "window"),
      paneId: text(fields[2], "pane"),
      panePid: integer(
        Number(fields[3]),
        "pane_process",
        1,
        Number.MAX_SAFE_INTEGER,
      ),
      serverIdentity: processIdentity(Number(fields[4])),
      unit: intent.unit,
      createdAt: intent.createdAt,
      ...(intent.resource ? { resource: intent.resource } : {}),
    },
  };
}

export function assertProof(connection: Connection, proof: LaunchProof): void {
  const record = proof.session;
  const fields = connection
    .tmux([
      "display-message",
      "-p",
      "-t",
      record.paneId,
      "#{pid}|#{session_id}|#{window_id}|#{pane_id}|#{pane_pid}|#{@pmcp-owner}|#{@pmcp-session}|#{@pmcp-launch}",
    ])
    .trim()
    .split("|");
  if (processIdentity(Number(fields[0])) !== record.serverIdentity)
    throw new Error("stale_launch_server");
  if (
    fields[1] !== record.tmuxSessionId ||
    fields[2] !== record.windowId ||
    fields[3] !== record.paneId ||
    Number(fields[4]) !== record.panePid
  )
    throw new Error("stale_launch_pane");
  if (
    fields[5] !== record.owner ||
    fields[6] !== record.id ||
    fields[7] !== proof.nonce
  )
    throw new Error("foreign_launch_pane");
}

export function panePresent(
  connection: Connection,
  proof: LaunchProof,
): boolean {
  if (!connection.alive()) return false;
  const rows = connection
    .tmux(["list-panes", "-a", "-F", "#{pid}|#{pane_id}"])
    .trim()
    .split("\n");
  const server = Number(rows[0]?.split("|")[0]);
  if (processIdentity(server) !== proof.session.serverIdentity)
    throw new Error("stale_launch_server");
  return rows.some((row) => row.split("|")[1] === proof.session.paneId);
}
