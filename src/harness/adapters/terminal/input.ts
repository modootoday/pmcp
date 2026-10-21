import { closeSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { processIdentity } from "../process/identity.js";
import type { Connection, Reply } from "./connection.js";

export function validateText(text: string): void {
  if (typeof text !== "string" || Buffer.byteLength(text) > 16_384)
    throw new Error("invalid_text");
  if (/[\x00-\x08\x0b-\x1f\x7f]/.test(text))
    throw new Error("control_character_rejected");
  if (/[\r\n\t]/.test(text))
    throw new Error("unqualified_terminal_control_input");
}

// pmcp-pty checks the instance, pid and lease with the input itself, so a restarted host, a
// reused id or another controller turns into a refusal, never into input in the wrong place.
function delivered(reply: Reply): void {
  if (reply["ok"] !== true) {
    const code = String(reply["code"] ?? "");
    throw new Error(
      code === "lease" ? "native_writer_active" : "delivery_uncertain",
    );
  }
  if (reply["accepted"] === false) throw new Error("delivery_uncertain");
}

export function write(
  connection: Connection,
  id: string,
  text: string,
  submit: boolean,
  lease?: string,
): Record<string, unknown> {
  validateText(text);
  const session = connection.inspect(id);
  if (!session.alive) throw new Error("runtime_exited");
  const lock = join(connection.records.directory, `${id}.input.lock`);
  const descriptor = openSync(lock, "wx", 0o600);
  try {
    writeFileSync(
      descriptor,
      JSON.stringify({ id, controller: processIdentity(process.pid) }),
    );
    const expect = connection.expect(session, lease);
    if (text.length > 0 || submit)
      delivered(
        connection.call({
          op: "write",
          id: session.ptySession,
          text,
          submit,
          guard: "none",
          expect,
        }),
      );
    return {
      id,
      verdict: "input_written",
      submitted: submit,
      processingConfirmed: false,
    };
  } finally {
    closeSync(descriptor);
    unlinkSync(lock);
  }
}

export function interrupt(
  connection: Connection,
  id: string,
  lease?: string,
): void {
  const session = connection.inspect(id);
  if (!session.alive) throw new Error("runtime_exited");
  const expect = connection.expect(session, lease);
  delivered(
    connection.call({ op: "key", id: session.ptySession, key: "C-c", expect }),
  );
}
