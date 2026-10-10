import type { Operation, Receipt } from "../contracts.js";
import { integer, text } from "../validation.js";
import { openGroup } from "../application/context.js";
import { observeSession } from "./service.js";

export async function watchSession(operation: Operation): Promise<Receipt> {
  const input = operation.input ?? {};
  const count = integer(input.count ?? 3, "watch_count", 1, 10);
  const intervalMs = integer(
    input.intervalMs ?? 500,
    "watch_interval",
    100,
    2000,
  );
  const snapshots = [];
  for (let index = 0; index < count; index += 1) {
    const context = openGroup(text(operation.groupFile, "group_file"));
    snapshots.push({
      observedAt: new Date().toISOString(),
      ...observeSession(
        context,
        "read",
        text(operation.sessionId, "session_id"),
      ),
    });
    if (index + 1 < count)
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return {
    schemaVersion: 1,
    ok: true,
    snapshots,
    providerStateInferred: false,
  };
}
