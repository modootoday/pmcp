// Report installation commands because native plugin installation mutates user state.

import {
  codexAddArguments,
  forRuntime,
  pluginId,
  type BuiltinRoot,
} from "./native.js";
import type { DeclaredMarketplace, MarketplaceCheck } from "./types.js";

export const CODEX_PLUGIN_LIST = ["plugin", "list", "--json", "--available"];

export interface CodexPluginState {
  readonly pluginId: string;
  readonly marketplaceName: string;
  readonly installed: boolean;
  readonly enabled: boolean;
}

function asState(value: unknown): CodexPluginState | null {
  if (value === null || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw["pluginId"] !== "string") return null;
  if (typeof raw["marketplaceName"] !== "string") return null;
  return {
    pluginId: raw["pluginId"],
    marketplaceName: raw["marketplaceName"],
    installed: raw["installed"] === true,
    enabled: raw["enabled"] === true,
  };
}

// Find JSON within output because native runners may combine stdout and stderr.
export function parseCodexPluginList(
  output: string,
): CodexPluginState[] | null {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start === -1 || end < start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.slice(start, end + 1));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const raw = parsed as Record<string, unknown>;
  const all = [raw["installed"], raw["available"]].flatMap((list) =>
    Array.isArray(list) ? list : [],
  );
  const states = new Map<string, CodexPluginState>();
  for (const state of all.map(asState)) {
    if (state && !states.get(state.pluginId)?.installed)
      states.set(state.pluginId, state);
  }
  return [...states.values()];
}

function pluginCheck(
  id: string,
  state: CodexPluginState | undefined,
): MarketplaceCheck {
  const check = `plugin ${id}`;
  if (!state)
    return { check, ok: false, detail: `not offered by its marketplace` };
  if (!state.installed)
    return {
      check,
      ok: false,
      detail: `not installed; run: codex plugin add ${id}`,
    };
  if (!state.enabled)
    return {
      check,
      ok: false,
      detail:
        "installed but disabled; trust the project so .codex/config.toml applies",
    };
  return { check, ok: true };
}

export function codexMarketplaceChecks(
  declared: readonly DeclaredMarketplace[],
  states: readonly CodexPluginState[],
  builtinRoot: BuiltinRoot,
): MarketplaceCheck[] {
  const checks: MarketplaceCheck[] = [];
  const byId = new Map(states.map((state) => [state.pluginId, state]));
  for (const { marketplace, plugins } of forRuntime(declared, "codex")) {
    const known = states.some((s) => s.marketplaceName === marketplace.name);
    const add = codexAddArguments(marketplace.source, builtinRoot).join(" ");
    checks.push(
      known
        ? { check: `marketplace ${marketplace.name}`, ok: true }
        : {
            check: `marketplace ${marketplace.name}`,
            ok: false,
            detail: `not configured; trust the project or run: codex plugin marketplace add ${add}`,
          },
    );
    if (!known) continue;
    const wanted = new Set(
      plugins.map((plugin) => pluginId(plugin, marketplace.name)),
    );
    for (const id of wanted) checks.push(pluginCheck(id, byId.get(id)));
    for (const state of states) {
      if (
        state.marketplaceName !== marketplace.name ||
        wanted.has(state.pluginId)
      )
        continue;
      if (!state.installed || !state.enabled) continue;
      checks.push({
        check: `plugin ${state.pluginId}`,
        ok: false,
        detail: `enabled but not declared; declare it or run: codex plugin remove ${state.pluginId}`,
      });
    }
  }
  return checks;
}
