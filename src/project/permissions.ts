// Element-level ownership of Claude permission rules; unmanaged rules and other settings stay.

import { join } from "node:path";

import { readJson } from "./apply/_shared.js";
import { readLock } from "./apply/lock.js";
import type { Finding } from "./doctor/types.js";
import { jsonOutput, type Output } from "./outputs.js";
import { overlaps, reconcile, SETTINGS } from "./permissions/reconcile.js";
import { BUCKETS, type BucketPlan } from "./permissions/types.js";
import type { ProjectSpec } from "./spec.js";

export { readPermissions } from "./permissions/reader.js";
export { SETTINGS as PERMISSION_SETTINGS } from "./permissions/reconcile.js";
export type { PermissionSpec } from "./permissions/types.js";

const PREFIX = `${SETTINGS}#permissions.`;

export const isPermissionPath = (path: string) => path.startsWith(PREFIX);

function owned(root: string): Map<string, string[]> {
  return new Map(
    readLock(root)
      .filter((entry) => isPermissionPath(entry.path))
      .map((entry) => [
        entry.path.slice(PREFIX.length),
        (entry.managed ?? []).filter((v): v is string => typeof v === "string"),
      ]),
  );
}

export function permissionPlans(spec: ProjectSpec): BucketPlan[] {
  const previous = owned(spec.root);
  const declared = spec.tools.has("claude")
    ? (spec.permissions?.claude ?? {})
    : {};
  if (previous.size === 0 && Object.keys(declared).length === 0) return [];
  const settings = readJson(join(spec.root, SETTINGS));
  return BUCKETS.flatMap((bucket) => {
    const mine = previous.get(bucket) ?? [];
    const wanted = declared[bucket] ?? [];
    if (mine.length === 0 && wanted.length === 0) return [];
    return [reconcile(settings, bucket, mine, wanted)];
  });
}

export function permissionOutputs(spec: ProjectSpec): Output[] {
  return permissionPlans(spec).map(
    (plan) =>
      ({
        ...jsonOutput(SETTINGS, ["permissions", plan.bucket], plan.value),
        managed: plan.managed,
      }) as Extract<Output, { kind: "json" }>,
  );
}

export const permissionConflicts = (spec: ProjectSpec) =>
  permissionPlans(spec).flatMap((plan) => plan.conflicts);

// A conflict already names the bucket for review, so its drift lines would only repeat it.
export const permissionProblems = (spec: ProjectSpec) =>
  permissionPlans(spec).flatMap((plan) =>
    plan.conflicts.length > 0 ? plan.conflicts : plan.drift,
  );

export function permissionWarnings(spec: ProjectSpec): string[] {
  if (!spec.tools.has("claude") || !spec.permissions) return [];
  const settings = readJson(join(spec.root, SETTINGS));
  return overlaps(settings, spec.permissions.claude, owned(spec.root));
}

function doctorStatus(conflicts: number, warnings: number): Finding["status"] {
  if (conflicts > 0) return "fail";
  return warnings > 0 ? "warn" : "ok";
}

export function permissionDoctor(spec: ProjectSpec): Finding[] {
  const plans = permissionPlans(spec);
  if (plans.length === 0)
    return [
      {
        tool: "claude",
        check: "permissions owned",
        status: "ok",
        detail: "none declared",
      },
    ];
  const conflicts = plans.flatMap((plan) => plan.conflicts);
  const warnings = permissionWarnings(spec);
  const counts = plans.map(
    (plan) =>
      `${plan.bucket}: ${plan.managed.length} owned, ${plan.borrowed.length} borrowed`,
  );
  return [
    {
      tool: "claude",
      check: "permissions owned",
      status: doctorStatus(conflicts.length, warnings.length),
      detail: (conflicts.length > 0
        ? conflicts
        : [...counts, ...warnings]
      ).join("; "),
    },
  ];
}
