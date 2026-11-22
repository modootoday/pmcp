import { openSqlite } from "../../storage/sqlite.js";

type Field = bigint | Uint8Array;

function fields(bytes: Uint8Array): Map<number, Field> {
  const result = new Map<number, Field>();
  let offset = 0;
  function readVarint(): bigint {
    let value = 0n;
    for (let shift = 0n; shift < 70n && offset < bytes.length; shift += 7n) {
      const byte = bytes[offset++]!;
      value |= BigInt(byte & 127) << shift;
      if (byte < 128) return value;
    }
    throw new Error("invalid_antigravity_wire_format");
  }
  while (offset < bytes.length) {
    const tag = Number(readVarint());
    const key = tag >>> 3;
    const wire = tag & 7;
    if (wire === 0) {
      result.set(key, readVarint());
      continue;
    }
    const widths: Record<number, number> = { 1: 8, 5: 4 };
    const length = wire === 2 ? Number(readVarint()) : widths[wire];
    if (length === undefined || length < 0 || length > bytes.length - offset) {
      throw new Error("invalid_antigravity_wire_format");
    }
    if (wire === 2) result.set(key, bytes.subarray(offset, offset + length));
    offset += length;
  }
  return result;
}

function bytes(value: Field | undefined): Uint8Array {
  if (!(value instanceof Uint8Array))
    throw new Error("invalid_antigravity_step");
  return value;
}

export async function readAntigravityHistory(path: string) {
  const { db } = await openSqlite(path, { readOnly: true });
  try {
    db.exec("PRAGMA trusted_schema = OFF");
    const meta = db
      .prepare<{ cascade_id: string }>("SELECT cascade_id FROM trajectory_meta")
      .all();
    if (meta.length !== 1) throw new Error("invalid_antigravity_trajectory");
    const steps = db
      .prepare<{
        step_type: number;
        step_format: number;
        step_payload: Uint8Array;
        metadata: Uint8Array;
      }>(
        "SELECT step_type, step_format, step_payload, metadata FROM steps WHERE step_type IN (14, 15) ORDER BY idx",
      )
      .all();
    return {
      id: meta[0]!.cascade_id,
      rows: steps.map((step) => {
        if (step.step_format !== 0)
          throw new Error("unsupported_antigravity_step_format");
        const user = step.step_type === 14;
        const payload = fields(
          bytes(fields(step.step_payload).get(user ? 19 : 20)),
        );
        const time = fields(bytes(fields(step.metadata).get(1)));
        const seconds = time.get(1);
        const nanos = time.get(2) ?? 0n;
        if (typeof seconds !== "bigint" || typeof nanos !== "bigint") {
          throw new Error("invalid_antigravity_timestamp");
        }
        return {
          role: user ? "user" : "assistant",
          content: new TextDecoder("utf-8", { fatal: true }).decode(
            bytes(payload.get(user ? 2 : 1)),
          ),
          timestamp: new Date(
            Number(seconds * 1000n + nanos / 1000000n),
          ).toISOString(),
        };
      }),
    };
  } finally {
    db.close();
  }
}
