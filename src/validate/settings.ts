import { resolve } from "node:path";

import {
  PROFILES,
  type ValidationProfile,
  type ValidationSettings,
} from "./types.js";

const KEYS = ["profile", "deny_list"];

// Reject unknown keys so a misspelt profile cannot silently skip a check.
export function readValidation(
  raw: unknown,
  dir: string,
  fail: (message: string) => never,
): ValidationSettings {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    fail("[catalog.validation] must be a table");
  const table = raw as Record<string, unknown>;
  for (const key of Object.keys(table)) {
    if (!KEYS.includes(key)) fail(`unknown key [catalog.validation] ${key}`);
  }
  const profile = table["profile"];
  const denyList = table["deny_list"];
  if (profile !== undefined && !PROFILES.includes(profile as ValidationProfile))
    fail(`[catalog.validation] profile must be ${PROFILES.join(" or ")}`);
  if (denyList !== undefined && (typeof denyList !== "string" || !denyList))
    fail("[catalog.validation] deny_list must be a path");
  return {
    ...(profile === undefined ? {} : { profile: profile as ValidationProfile }),
    ...(denyList === undefined
      ? {}
      : { denyList: resolve(dir, denyList as string) }),
  };
}
