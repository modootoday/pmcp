import type { CompiledGuard } from "../compiled.js";
import { FEATURES } from "../policies/index.js";
import { checkoutOf } from "../../sessions/checkout.js";
import { asTable } from "./types.js";

export type FeatureSource = "toml" | "auto" | "default-off";

function featureSource(
  declared: boolean,
  setting: "auto" | boolean,
  on: boolean,
): FeatureSource {
  if (declared || setting !== "auto") return "toml";
  return on ? "auto" : "default-off";
}

export interface WorkspaceTables {
  readonly declared: boolean;
  readonly sharedCheckout: {
    readonly guard: CompiledGuard | null;
    readonly source: FeatureSource;
  };
}

function enabledValue(value: unknown, where: string): "auto" | boolean {
  if (value === undefined || value === "auto" || typeof value === "boolean")
    return value ?? "auto";
  throw new Error(`${where} enabled must be "auto", true or false`);
}

// Default git features to detection so declared overrides can opt out explicitly.
export function readWorkspace(raw: unknown, root: string): WorkspaceTables {
  const git = asTable(raw, "[git]");
  const gitEnabled = enabledValue(git["enabled"], "[git]");
  const declared = git["shared_checkout"] !== undefined;
  const { enabled, ...options } = asTable(
    git["shared_checkout"],
    "[git.shared_checkout]",
  );
  const own = enabledValue(enabled, "[git.shared_checkout]");
  const setting = own === "auto" ? gitEnabled : own;
  const on = setting === "auto" ? checkoutOf(root) !== null : setting;
  const source = featureSource(declared, setting, on);
  if (!on) return { declared, sharedCheckout: { guard: null, source } };
  try {
    FEATURES["git.shared_checkout"]!.options(options);
  } catch (error) {
    throw new Error(
      `[git.shared_checkout] ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    declared,
    sharedCheckout: {
      guard: { id: "git.shared_checkout", mode: "warn", options },
      source,
    },
  };
}
