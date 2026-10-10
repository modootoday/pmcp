import type { ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { command } from "../process/command.js";
import { processIdentity } from "../process/identity.js";
import type { SessionObservation } from "../../contracts.js";
import type { RecordStore } from "./records.js";
import { resourceRunning } from "../docker/observation.js";

export class Connection {
  constructor(readonly records: RecordStore) {}

  tmux(
    args: string[],
    options: Partial<ExecFileSyncOptionsWithStringEncoding> = {},
  ): string {
    return command(
      "tmux",
      ["-S", this.records.socket, "-f", this.records.configPath, ...args],
      options,
    );
  }

  alive(): boolean {
    try {
      this.tmux(["list-sessions"]);
      return true;
    } catch (error) {
      const failure = error as Error & { stderr?: unknown };
      if (
        /no server running|No such file or directory|no sessions/.test(
          String(failure.stderr ?? failure.message),
        )
      )
        return false;
      throw error;
    }
  }

  inspect(id: string): SessionObservation {
    const record = this.records.read(id);
    const target = this.tmux([
      "display-message",
      "-p",
      "-t",
      record.paneId,
      "#{pid}|#{pane_id}|#{pane_pid}|#{pane_dead}|#{@pmcp-owner}|#{@pmcp-session}|#{pane_width}|#{pane_height}|#{session_id}|#{window_id}",
    ])
      .trim()
      .split("|");
    const [
      serverPid,
      paneId,
      panePid,
      dead,
      owner,
      sessionId,
      width,
      height,
      tmuxSessionId,
      windowId,
    ] = target;
    if (processIdentity(Number(serverPid)) !== record.serverIdentity)
      throw new Error("stale_server");
    if (
      paneId !== record.paneId ||
      Number(panePid) !== record.panePid ||
      tmuxSessionId !== record.tmuxSessionId ||
      windowId !== record.windowId
    )
      throw new Error("stale_pane");
    if (owner !== this.records.owner || sessionId !== id)
      throw new Error("foreign_pane");
    return {
      ...record,
      alive:
        dead === "0" && (!record.resource || resourceRunning(record.resource)),
      width: Number(width),
      height: Number(height),
    };
  }
}
