// Every spelling of a runtime lives here; other modules derive their lists from these tables
// so a runtime added or renamed in one place reaches hooks, harness, host, export and the TUI.
export const RUNTIME_IDS = [
  "claude",
  "codex",
  "gemini",
  "antigravity",
  "grok",
  "opencode",
] as const;
export type RuntimeId = (typeof RUNTIME_IDS)[number];

// Product names as skill metadata (verified-runtimes) and MCP client names publish them.
export const PRODUCT_NAMES = [
  "claude-code",
  "codex-cli",
  "gemini-cli",
  "grok-cli",
  "antigravity",
] as const;
export type ProductName = (typeof PRODUCT_NAMES)[number];

export const PRODUCT_OF: Readonly<Record<ProductName, RuntimeId>> = {
  "claude-code": "claude",
  "codex-cli": "codex",
  "gemini-cli": "gemini",
  "grok-cli": "grok",
  antigravity: "antigravity",
};

// The command each runtime is started with; antigravity's is agy.
export const EXECUTABLES = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
  antigravity: "agy",
  grok: "grok",
  opencode: "opencode",
} as const satisfies Readonly<Record<RuntimeId, string>>;
export type Executable = (typeof EXECUTABLES)[RuntimeId];

const ALIASES: ReadonlyMap<string, RuntimeId> = new Map<string, RuntimeId>([
  ...RUNTIME_IDS.map((id) => [id, id] as const),
  ...PRODUCT_NAMES.map((name) => [name, PRODUCT_OF[name]] as const),
  ...RUNTIME_IDS.map((id) => [EXECUTABLES[id], id] as const),
]);

// Any spelling a user may type (id, product name or command), or null.
export function runtimeIdOf(name: string): RuntimeId | null {
  return ALIASES.get(name.trim().toLowerCase()) ?? null;
}

export function productNameOf(id: RuntimeId): ProductName | null {
  return PRODUCT_NAMES.find((name) => PRODUCT_OF[name] === id) ?? null;
}

export function spellingsOf(id: RuntimeId): string[] {
  return [...ALIASES].filter(([, to]) => to === id).map(([from]) => from);
}
