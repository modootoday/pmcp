import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import semver from "semver";

import { VERSION } from "../../commands/version.js";

const PACKAGE = "@modootoday/pmcp";
const FIELDS = ["dependencies", "devDependencies", "optionalDependencies"];

function pinnedVersion(configPath: string): string | null {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(
      readFileSync(join(dirname(configPath), "package.json"), "utf8"),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
  for (const field of FIELDS) {
    const deps = manifest[field] as Record<string, unknown> | undefined;
    const pin = deps?.[PACKAGE];
    if (typeof pin === "string") return semver.valid(pin);
  }
  return null;
}

// A checkout whose package.json pins a newer pmcp than the one running was moved without its
// install, so a key it refuses is most likely one that newer release reads.
export function newerPinHint(configPath: string): string {
  const pin = pinnedVersion(configPath);
  if (!pin || !semver.gt(pin, VERSION)) return "";
  return `; this checkout pins ${PACKAGE} ${pin} but runs ${VERSION}: install the pinned version (for example bun install --frozen-lockfile, or npm ci) and run the command again`;
}
