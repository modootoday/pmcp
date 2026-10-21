import { join } from "node:path";

import { PERMISSION_SETTINGS } from "../permissions.js";
import { plan } from "../plan.js";
import type { ProjectSpec } from "../spec.js";
import { fingerprint } from "./_shared.js";
import { readLock } from "./lock.js";
import { readNativeJson } from "./native.js";

export function prepare(spec: ProjectSpec) {
  // Snapshot before planning so an edit made while planning is caught before the write.
  const basis = new Map([
    [PERMISSION_SETTINGS, fingerprint(join(spec.root, PERMISSION_SETTINGS))],
  ]);
  const lock = readLock(spec.root);
  const ownedTargets = new Map(
    lock
      .filter((entry) => entry.kind === "link" && entry.target !== undefined)
      .map((entry) => [entry.path, entry.target as string]),
  );
  const outputs = plan(spec, ownedTargets);
  const owned = new Set(lock.map((entry) => entry.path));
  const planned = new Set(outputs.map((output) => output.path));
  const stale = lock.filter((entry) => !planned.has(entry.path));
  readNativeJson(spec.root, outputs, stale);
  return { outputs, owned, stale, basis };
}
