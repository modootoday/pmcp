import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { GroupContext } from "../../application/context.js";
import { privateJson, readPrivateJson } from "../../groups/store.js";
import { integer, object } from "../../validation.js";
import { assertOwnedRecords } from "../tmux/backend.js";
import { budgetSlice } from "../tmux/records.js";

export function configureBudget(
  context: GroupContext,
  input: Record<string, unknown>,
): { memoryMb: number; maxActive: number } {
  const { store, backend } = context;
  assertOwnedRecords(backend);
  const group = store.state.group;
  const memoryMb = integer(
    input.memoryMb ?? group.memoryMb,
    "memory_budget",
    128,
    4096,
  );
  const maxActive = integer(
    input.maxActive ?? group.maxActive,
    "max_active",
    1,
    5,
  );
  const active = backend
    .records()
    .filter((record) => !record.stoppedAt && backend.inspect(record.id).alive);
  if (active.length > maxActive)
    throw new Error("capacity_below_active_sessions");
  if (active.reduce((total, session) => total + session.memoryMb, 0) > memoryMb)
    throw new Error("budget_below_reserved_memory");
  const path = join(backend.runDirectory, "runtime-policy.json");
  const policy = object(readPrivateJson(path));
  const metadata = object(readPrivateJson(backend.metadataPath));
  const slice = budgetSlice(backend.owner);
  if (
    policy.owner !== backend.owner ||
    policy.slice !== slice ||
    metadata.budgetSlice !== slice
  )
    throw new Error("foreign_budget_policy");
  execFileSync(
    "systemctl",
    [
      "--user",
      "set-property",
      "--runtime",
      slice,
      `MemoryMax=${memoryMb}M`,
      `MemoryHigh=${Math.floor(memoryMb * 0.8)}M`,
    ],
    { timeout: 5000 },
  );
  privateJson(path, {
    ...policy,
    memoryMb,
    maxActive,
    memoryHighMb: Math.floor(memoryMb * 0.8),
  });
  return { memoryMb, maxActive };
}
