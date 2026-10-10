import { join } from "node:path";
import { privateJson, readPrivateJson } from "../../harness/groups/store.js";
import type { View, Snapshot, PanelRole } from "../contracts.js";
import { CommonHarness } from "../application/common.js";

export function freshSnapshot(
  cached: { observedAt: string; snapshot: Snapshot },
  now = Date.now(),
): Snapshot {
  const age = now - Date.parse(cached.observedAt);
  if (!Number.isFinite(age) || age < 0 || age > 5000)
    throw new Error("stale_observation");
  return cached.snapshot;
}

export async function observePanel(
  view: View,
  role: PanelRole,
): Promise<Snapshot> {
  const cache = join(view.directory, "observation.json");
  if (role === "coordination")
    return freshSnapshot(
      readPrivateJson(cache) as { observedAt: string; snapshot: Snapshot },
    );
  const snapshot = await new CommonHarness(view).snapshot();
  privateJson(cache, { observedAt: new Date().toISOString(), snapshot });
  return snapshot;
}
