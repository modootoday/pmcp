import { backupFiles } from "../backup.js";
import { BUNDLE_NATIVE_FILES } from "../hook-bundle.js";
import { HOOK_DIRECTORY } from "../hooks.js";
import { ANTIGRAVITY_MCP_PLUGIN } from "../mcp.js";
import { splitKeyed, type Output } from "../outputs.js";
import type { ProjectSpec } from "../spec.js";
import { LOCK_FILE } from "./lock.js";
import { present } from "./present.js";
import type { LockEntry } from "./types.js";

const MCP_PATHS = [
  "opencode.json",
  ".mcp.json",
  ".gemini/settings.json",
  ".agents/mcp_config.json",
  `${ANTIGRAVITY_MCP_PLUGIN}/plugin.json`,
  `${ANTIGRAVITY_MCP_PLUGIN}/mcp_config.json`,
  ".codex/config.toml",
  ".grok/config.toml",
];

// Back up mutable native configuration so projection changes remain recoverable.
export function backupBeforeWrite(
  spec: ProjectSpec,
  outputs: readonly Output[],
  stale: readonly LockEntry[],
): string | undefined {
  const changedMcp = outputs.some((output) => {
    if (
      output.kind !== "json" &&
      output.kind !== "block" &&
      output.kind !== "file"
    ) {
      return false;
    }
    const path = output.kind === "file" ? output.path : output.file;
    return MCP_PATHS.includes(path) && !present(spec.root, output);
  });
  const staleMcp = stale.some((entry) =>
    MCP_PATHS.includes(splitKeyed(entry.path)?.file ?? ""),
  );
  const hookPaths = [
    ...new Set([
      ...BUNDLE_NATIVE_FILES,
      ".gemini/settings.json",
      ".agents/hooks.json",
    ]),
    ...outputs
      .filter(
        (output) =>
          output.kind === "file" &&
          output.path.startsWith(`${HOOK_DIRECTORY}/`),
      )
      .map((output) => output.path),
    ...stale
      .filter((entry) => entry.path.startsWith(`${HOOK_DIRECTORY}/`))
      .map((entry) => entry.path),
  ];
  const changedHooks =
    outputs.some(
      (output) =>
        ((output.kind === "json" && output.managed !== undefined) ||
          (output.kind === "file" &&
            output.path.startsWith(`${HOOK_DIRECTORY}/`))) &&
        !present(spec.root, output),
    ) || stale.some((entry) => entry.path.startsWith(`${HOOK_DIRECTORY}/`));
  if (!changedMcp && !staleMcp && !changedHooks) return undefined;
  return backupFiles(spec.root, [
    ...MCP_PATHS,
    ...(changedHooks ? hookPaths : []),
    LOCK_FILE,
  ]);
}
