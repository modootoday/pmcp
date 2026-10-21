import { ConfigError } from "../config.js";
import { compileHooks, type CompiledHooks } from "../hooks/compile.js";

export const HOOK_TOOLS = ["codex", "gemini", "antigravity"] as const;
export type HookTool = (typeof HOOK_TOOLS)[number];

export interface ShellHookSpec {
  readonly name: string;
  readonly command: readonly string[];
  readonly targets: readonly HookTool[];
  readonly timeoutMs: number;
  readonly event?: "after_edit";
}

export interface HookSpecs {
  readonly legacy: ShellHookSpec[];

  readonly bundle: Omit<CompiledHooks, "legacy"> | null;
  readonly sources: CompiledHooks["sources"];
  readonly deprecations: readonly string[];
}

export function readHooks(
  path: string,
  root: string,
  raw: Readonly<Record<string, unknown>>,
  tools: ReadonlySet<string>,
): HookSpecs {
  let compiled: CompiledHooks;
  try {
    compiled = compileHooks(
      {
        hooks: raw["hooks"],
        sessions: raw["sessions"],
        git: raw["git"],
        logging: raw["logging"],
        host: raw["host"],
      },
      { root, tools },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(
      path,
      message.startsWith("[") ? message : `[hooks] ${message}`,
    );
  }
  const legacy = compiled.legacy.map((entry): ShellHookSpec => ({
    name: entry.name,
    command: entry.command,
    targets: entry.targets as HookTool[],
    timeoutMs: entry.timeoutMs,
    ...(entry.event === "after_edit" ? { event: "after_edit" as const } : {}),
  }));
  const bundle = compiled.policy
    ? {
        policy: compiled.policy,
        edits: compiled.edits,
        files: compiled.files,
        sources: compiled.sources,
      }
    : null;
  return {
    legacy,
    bundle,
    sources: compiled.sources,
    deprecations: deprecations(raw["hooks"]),
  };
}

// The pre-bundle tables still work but say what replaces them (a release-note deprecation).
function deprecations(hooks: unknown): string[] {
  const table = (hooks ?? {}) as Record<string, unknown>;
  return ["shell", "edit"]
    .filter((key) => table[key] !== undefined)
    .map(
      (key) =>
        `[[hooks.${key}]] is deprecated; declare [[hooks.guards.custom]] with on = "${key === "shell" ? "before_shell" : "after_edit"}" and list its runtimes in [hooks] targets`,
    );
}
