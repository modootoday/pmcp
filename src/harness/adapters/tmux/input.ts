import { randomUUID } from "node:crypto";
import { closeSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionObservation } from "../../contracts.js";
import { processIdentity } from "../process/identity.js";
import { quote } from "../process/command.js";
import type { Connection } from "./connection.js";

export function validateText(text: string): void {
  if (typeof text !== "string" || Buffer.byteLength(text) > 16_384)
    throw new Error("invalid_text");
  if (/[\x00-\x08\x0b-\x1f\x7f]/.test(text))
    throw new Error("control_character_rejected");
  if (/[\r\n\t]/.test(text))
    throw new Error("unqualified_terminal_control_input");
}

function guarded(
  connection: Connection,
  session: SessionObservation,
  args: string[],
): void {
  const owner = `#{==:#{@pmcp-owner},${session.owner}}`;
  const identity = `#{==:#{@pmcp-session},${session.id}}`;
  const process = `#{==:#{pane_pid},${session.panePid}}`;
  const alive = "#{==:#{pane_dead},0}";
  const condition = `#{&&:${owner},#{&&:${identity},#{&&:${process},${alive}}}}`;
  const output = connection.tmux([
    "if-shell",
    "-F",
    "-t",
    session.paneId,
    condition,
    args.map(quote).join(" "),
    "display-message -p delivery_uncertain",
  ]);
  if (output.includes("delivery_uncertain"))
    throw new Error("delivery_uncertain");
}

export function write(
  connection: Connection,
  id: string,
  text: string,
  submit: boolean,
): Record<string, unknown> {
  validateText(text);
  const session = connection.inspect(id);
  if (!session.alive) throw new Error("runtime_exited");
  const lock = join(connection.records.directory, `${id}.input.lock`);
  const descriptor = openSync(lock, "wx", 0o600);
  const buffer = `pmcp-${randomUUID()}`;
  try {
    writeFileSync(
      descriptor,
      JSON.stringify({ id, controller: processIdentity(process.pid) }),
    );
    if (text.length > 0) {
      connection.tmux(["load-buffer", "-b", buffer, "-"], { input: text });
      connection.inspect(id);
      guarded(connection, session, [
        "paste-buffer",
        "-d",
        "-p",
        "-r",
        "-b",
        buffer,
        "-t",
        session.paneId,
      ]);
    }
    if (submit) {
      connection.inspect(id);
      guarded(connection, session, [
        "send-keys",
        "-t",
        session.paneId,
        "Enter",
      ]);
    }
    return {
      id,
      verdict: "input_written",
      submitted: submit,
      processingConfirmed: false,
    };
  } finally {
    try {
      connection.tmux(["delete-buffer", "-b", buffer]);
    } catch {}
    closeSync(descriptor);
    unlinkSync(lock);
  }
}

export function interrupt(connection: Connection, id: string): void {
  const session = connection.inspect(id);
  if (!session.alive) throw new Error("runtime_exited");
  guarded(connection, session, ["send-keys", "-t", session.paneId, "C-c"]);
}
