import { BUCKETS, type Bucket, type BucketPlan } from "./types.js";

export const SETTINGS = ".claude/settings.json";

const count = (list: readonly string[], value: string) =>
  list.filter((item) => item === value).length;

function currentRules(
  settings: Record<string, unknown>,
  bucket: Bucket,
): { rules: readonly string[]; present: boolean; problem?: string } {
  const container = settings["permissions"];
  if (container === undefined) return { rules: [], present: false };
  if (container === null || typeof container !== "object")
    return { rules: [], present: false, problem: "is not a table" };
  if (Array.isArray(container))
    return { rules: [], present: false, problem: "is not a table" };
  const raw = (container as Record<string, unknown>)[bucket];
  if (raw === undefined) return { rules: [], present: false };
  if (!Array.isArray(raw) || !raw.every((v) => typeof v === "string"))
    return { rules: [], present: true, problem: "is not a list of strings" };
  return { rules: raw as string[], present: true };
}

// Native precedence decides an unmanaged rule in another bucket, so it is reported, never removed.
export function overlaps(
  settings: Record<string, unknown>,
  declared: Readonly<Partial<Record<Bucket, readonly string[]>>>,
  owned: ReadonlyMap<string, readonly string[]>,
): string[] {
  const found: string[] = [];
  for (const [bucket, rules] of Object.entries(declared)) {
    for (const other of BUCKETS) {
      if (other === bucket) continue;
      const mine = owned.get(other) ?? [];
      const native = currentRules(settings, other).rules.filter(
        (rule) => !mine.includes(rule),
      );
      for (const rule of rules.filter((item) => native.includes(item)))
        found.push(
          `overlap: ${SETTINGS}#permissions.${other} has unmanaged ${rule}, declared in ${bucket}`,
        );
    }
  }
  return found;
}

// Unmanaged entries keep their order and duplicates; pmcp removes only what it inserted.
// A declared entry already present is borrowed, never owned. An owned entry missing from an
// existing array was edited by hand, so it is a conflict rather than a guess at intent.
export function reconcile(
  settings: Record<string, unknown>,
  bucket: Bucket,
  owned: readonly string[],
  declared: readonly string[],
): BucketPlan {
  const where = `${SETTINGS}#permissions.${bucket}`;
  const current = currentRules(settings, bucket);
  const conflicts: string[] = [];
  if (current.problem !== undefined) {
    const key = current.present ? `permissions.${bucket}` : "permissions";
    conflicts.push(`conflict: ${SETTINGS}#${key} ${current.problem}`);
  }
  const rules = current.rules;
  for (const rule of owned) {
    const found = count(rules, rule);
    if (found === 0 && current.present && current.problem === undefined)
      conflicts.push(
        `conflict: ${where} owned entry edited or removed ${rule}`,
      );
    if (found > 1)
      conflicts.push(`conflict: ${where} owned entry is duplicated ${rule}`);
  }
  const dropped = owned.filter(
    (rule) => !declared.includes(rule) && rules.includes(rule),
  );
  const missing = declared.filter((rule) => !rules.includes(rule));
  const value = [
    ...rules.filter((rule) => !dropped.includes(rule)),
    ...missing,
  ];
  const managed = declared.filter(
    (rule) => owned.includes(rule) || !rules.includes(rule),
  );
  return {
    bucket,
    value,
    managed,
    borrowed: declared.filter((rule) => !managed.includes(rule)),
    drift: [
      ...missing.map((rule) => `drift: ${where} missing ${rule}`),
      ...dropped.map((rule) => `drift: ${where} no longer declared ${rule}`),
    ],
    conflicts,
  };
}
