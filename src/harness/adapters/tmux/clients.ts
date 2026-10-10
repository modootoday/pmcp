import type { Backend } from "./backend.js";

export interface AttachedClient {
  pid: number;
  tty: string;
  readOnly: boolean;
}

export function attachedClients(
  backend: Backend,
  sessionId: string,
): AttachedClient[] {
  const session = backend.inspect(sessionId);
  if (!session.alive) throw new Error("session_unavailable");
  const output = backend
    .tmux([
      "list-clients",
      "-F",
      "#{session_id}|#{client_pid}|#{client_readonly}|#{client_tty}",
    ])
    .trim();
  if (!output) return [];
  return output.split("\n").flatMap((line) => {
    const [id, pid, readOnly, tty] = line.split("|");
    if (id !== session.tmuxSessionId) return [];
    if (
      !/^\d+$/.test(pid ?? "") ||
      !tty ||
      !["0", "1"].includes(readOnly ?? "")
    )
      throw new Error("attachment_observation_unknown");
    return [{ pid: Number(pid), tty, readOnly: readOnly === "1" }];
  });
}
