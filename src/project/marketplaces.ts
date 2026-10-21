import { publicMarketplaceRoot } from "../marketplace/builtin.js";
import {
  CODEX_PLUGIN_LIST,
  claudeSettings,
  codexConfig,
  codexMarketplaceChecks,
  forRuntime,
  parseCodexPluginList,
} from "../marketplace/declared/index.js";
import type { Finding, Runner } from "./doctor.js";
import { blockOutput, jsonOutput, type Output } from "./outputs.js";
import type { ProjectSpec } from "./spec.js";

const CLAUDE_SETTINGS = ".claude/settings.json";
const CODEX_CONFIG = ".codex/config.toml";

const builtinRoot = () => publicMarketplaceRoot();

export function marketplaceOutputs(spec: ProjectSpec): Output[] {
  const declared = spec.marketplaces ?? [];
  const outputs: Output[] = [];
  if (spec.tools.has("claude")) {
    for (const { key, value } of claudeSettings(declared, builtinRoot))
      outputs.push(jsonOutput(CLAUDE_SETTINGS, key, value));
  }
  const toml = spec.tools.has("codex")
    ? codexConfig(declared, builtinRoot)
    : "";
  if (toml) outputs.push(blockOutput(CODEX_CONFIG, toml));
  return outputs;
}

export function marketplaceDoctor(spec: ProjectSpec, run: Runner): Finding[] {
  const declared = spec.marketplaces ?? [];
  if (forRuntime(declared, "codex").length === 0) return [];
  const check = "declared plugins";
  const result = run("codex", CODEX_PLUGIN_LIST, spec.root);
  if (result.missing) return [{ tool: "codex", check, status: "skip" }];
  const states = parseCodexPluginList(result.stdout);
  if (!states)
    return [
      {
        tool: "codex",
        check,
        status: "fail",
        detail: "codex plugin list printed no JSON",
      },
    ];
  return codexMarketplaceChecks(declared, states, builtinRoot).map((item) => ({
    tool: "codex",
    check: item.check,
    status: item.ok ? "ok" : "fail",
    ...(item.detail ? { detail: item.detail } : {}),
  }));
}
