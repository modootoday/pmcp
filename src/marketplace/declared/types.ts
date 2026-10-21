export const MARKETPLACE_RUNTIMES = ["claude", "codex"] as const;
export type MarketplaceRuntime = (typeof MARKETPLACE_RUNTIMES)[number];

export type MarketplaceSource =
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "github"; readonly repo: string; readonly ref?: string }
  | { readonly kind: "builtin" };

export interface DeclaredPlugin {
  readonly name: string;
  readonly targets: readonly MarketplaceRuntime[];
}

export interface DeclaredMarketplace {
  readonly name: string;
  readonly source: MarketplaceSource;

  readonly catalog?: boolean;
  readonly plugins: readonly DeclaredPlugin[];
}

export interface KeyedValue {
  readonly key: readonly string[];
  readonly value: unknown;
}

export interface MarketplaceCheck {
  readonly check: string;
  readonly ok: boolean;
  readonly detail?: string;
}
