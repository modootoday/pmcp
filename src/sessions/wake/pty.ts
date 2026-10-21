import { createConnection } from "node:net";

import type { SessionRecord } from "../types.js";
import { ptyRef } from "./pty-ref.js";
import type { WakeEnv, WakeResult } from "./types.js";

// A session hosted by pmcp-pty is woken with one turn request: the host picks the delivery
// channel (inbox, server, queue, ACP or a guarded screen write) and reports which. The turn is
// short: pmcp needs the delivery, not the reply, and the mail stays with the session's hooks.
const TURN_MS = 2000;
const LIMIT_MS = 8000;

type Reply = Record<string, unknown>;

function request(socket: string, line: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const client = createConnection(socket);
    let text = "";
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error(`no reply from ${socket} within ${LIMIT_MS} ms`));
    }, LIMIT_MS);
    client.on("connect", () => client.write(`${line}\n`));
    client.on("data", (chunk) => {
      text += chunk.toString("utf8");
      const end = text.indexOf("\n");
      if (end < 0) return;
      clearTimeout(timer);
      client.end();
      try {
        resolve(JSON.parse(text.slice(0, end)) as Reply);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    client.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

// Delivered means a turn started or was queued; refused and gone leave the mail for next event.
function resultOf(record: SessionRecord, reply: Reply): WakeResult {
  const base = {
    session: record.session,
    runtime: record.runtime ?? "unknown",
    transport: "pmcp-pty" as const,
  };
  if (reply["ok"] !== true) {
    const detail = `pmcp-pty ${String(reply["code"])}: ${String(reply["message"])}`;
    return { ...base, outcome: "not-wakeable", detail, receipt: reply };
  }
  const outcome = String(reply["outcome"]);
  const receipt = (reply["receipt"] ?? {}) as Reply;
  const channel = String(receipt["channel"] ?? "screen");
  const fallback = receipt["fallback"]
    ? `; fallback ${String(receipt["fallback"])}`
    : "";
  if (outcome === "refused" || outcome === "exited") {
    const why = String(receipt["reason"] ?? reply["code"] ?? outcome);
    return {
      ...base,
      outcome: "not-wakeable",
      detail: `${outcome}: ${why}${fallback}`,
      receipt: reply,
    };
  }
  return {
    ...base,
    outcome: "woken",
    detail: `turn ${outcome} via ${channel}${fallback}`,
    receipt: reply,
  };
}

export async function ptyTurn(
  record: SessionRecord,
  text: string,
  _context: WakeEnv,
): Promise<WakeResult> {
  const ref = ptyRef(record)!;
  const line = JSON.stringify({
    op: "turn",
    id: ref.session,
    text,
    timeout_ms: TURN_MS,
    expect: { instance: ref.instance },
    target: { session: record.session },
  });
  try {
    return resultOf(record, await request(ref.socket, line));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      session: record.session,
      runtime: record.runtime ?? "unknown",
      outcome: "not-wakeable",
      transport: "pmcp-pty",
      detail: `pmcp-pty unreachable: ${reason}`,
    };
  }
}
