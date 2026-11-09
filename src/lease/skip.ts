import type { LeaseSettings } from "./config.js";

// A lease skip names why a command goes around the lease, from a closed set: what pmcp sets
// itself, the operator's own, and the reasons the project lists. Free text would make the
// measured share of skipped runs unreadable, and any caller could claim any reason.

export const NESTED = "nested";
export const OPERATOR = "operator";
// What pmcp before 0.25 set inside a leased job; read as nested for one minor release.
const LEGACY_NESTED = /^inside pmcp heavy \d+$/u;

export interface SkipChecks {
  // Whether a leased job encloses this command (its marker names a live running job).
  readonly nested: () => boolean;
  readonly operator: () => boolean;
}

export function allowedReasons(settings: LeaseSettings): string[] {
  return [
    ...new Set([
      NESTED,
      OPERATOR,
      ...settings.skipReasons,
      ...settings.skipAlways,
    ]),
  ];
}

// Why the reason is refused, or null when it is allowed.
export function skipRefusal(
  settings: LeaseSettings,
  reason: string,
  checks: SkipChecks,
): string | null {
  if (reason === NESTED || LEGACY_NESTED.test(reason))
    return checks.nested()
      ? null
      : `${NESTED} is the reason pmcp sets inside a leased job, and no leased job encloses this one`;
  if (reason === OPERATOR)
    return checks.operator()
      ? null
      : `${OPERATOR} is the operator's own skip, from the operator's terminal or with the operator token`;
  if (settings.skipReasons.includes(reason)) return null;
  if (settings.skipAlways.includes(reason)) return null;
  return `"${reason}" is not a lease skip reason`;
}
