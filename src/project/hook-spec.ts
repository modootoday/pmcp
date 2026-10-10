import { ConfigError } from "../config.js";
import { guardPath } from "./hook-adapter.js";

export const HOOK_TOOLS = ["codex", "gemini", "antigravity"] as const;
export type HookTool = (typeof HOOK_TOOLS)[number];

export interface ShellHookSpec {
  readonly name: string;
  readonly command: readonly string[];
  readonly targets: readonly HookTool[];
  readonly timeoutMs: number;
}

export function readHooks(
  path: string,
  root: string,
  raw: unknown,
): ShellHookSpec[] {
  if (raw === undefined) {
    return [];
  }
  const fail = (reason: string): never => {
    throw new ConfigError(path, `[hooks] ${reason}`);
  };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return fail("must be a table");
  }
  const table = raw as Record<string, unknown>;
  if (
    Object.keys(table).some((key) => key !== "shell") ||
    !Array.isArray(table["shell"])
  ) {
    return fail("only [[hooks.shell]] declarations are supported");
  }
  const names = new Set<string>();
  return table["shell"]
    .map((value: unknown) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return fail("shell entry must be a table");
      }
      const entry = value as Record<string, unknown>;
      if (
        Object.keys(entry).some(
          (key) => !["name", "command", "targets", "timeout_ms"].includes(key),
        )
      ) {
        return fail("unknown shell entry field");
      }
      const name = entry["name"];
      const command = entry["command"];
      const targets = entry["targets"];
      const timeoutMs = entry["timeout_ms"] ?? 15000;
      if (
        typeof name !== "string" ||
        !/^[a-z0-9][a-z0-9-]*$/u.test(name) ||
        names.has(name)
      ) {
        return fail("shell names must be unique lowercase names");
      }
      if (
        !Array.isArray(command) ||
        command.length === 0 ||
        !command.every(
          (part) =>
            typeof part === "string" && part.length > 0 && !part.includes("\0"),
        )
      ) {
        return fail("command must be a nonempty argument list");
      }
      if (
        !Array.isArray(targets) ||
        targets.length === 0 ||
        !targets.every((tool) =>
          (HOOK_TOOLS as readonly unknown[]).includes(tool),
        ) ||
        new Set(targets).size !== targets.length
      ) {
        return fail("targets must select unique supported shell adapters");
      }
      if (
        typeof timeoutMs !== "number" ||
        !Number.isSafeInteger(timeoutMs) ||
        timeoutMs < 100 ||
        timeoutMs > 60000
      ) {
        return fail("timeout_ms must be an integer from 100 to 60000");
      }
      try {
        guardPath(root, command as string[]);
      } catch (error) {
        return fail(
          error instanceof Error ? error.message : "invalid guard path",
        );
      }
      names.add(name);
      return {
        name,
        command: command as string[],
        targets: targets as HookTool[],
        timeoutMs,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}
