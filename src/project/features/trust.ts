import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "smol-toml";

import { HOOK_FILE } from "../../hooks/compiled.js";

export type TrustState = "trusted" | "untrusted" | "unknown";

const snake = (native: string) =>
  native.replace(/([a-z])([A-Z])/gu, "$1_$2").toLowerCase();

export function codexTrustKeys(
  home: string,
  env: Readonly<Record<string, string | undefined>>,
): Set<string> | null {
  const file = join(env["CODEX_HOME"] ?? join(home, ".codex"), "config.toml");
  if (!existsSync(file)) return null;
  try {
    const config = parse(readFileSync(file, "utf8")) as {
      hooks?: { state?: Record<string, unknown> };
    };
    return new Set(Object.keys(config.hooks?.state ?? {}));
  } catch {
    return null;
  }
}

export function codexTrust(
  root: string,
  natives: readonly string[],
  keys: Set<string> | null,
): TrustState {
  if (!keys) return "unknown";
  const file = join(root, ".codex/hooks.json");
  if (!existsSync(file)) return "untrusted";
  const hooks =
    (
      JSON.parse(readFileSync(file, "utf8")) as {
        hooks?: Record<string, unknown[]>;
      }
    ).hooks ?? {};
  for (const native of natives) {
    const groups = (hooks[native] ?? []) as {
      hooks?: { command?: string }[];
    }[];
    const group = groups.findIndex((entry) =>
      (entry.hooks ?? []).some((hook) => hook.command?.includes(HOOK_FILE)),
    );
    if (group < 0 || !keys.has(`${file}:${snake(native)}:${group}:0`))
      return "untrusted";
  }
  return "trusted";
}
