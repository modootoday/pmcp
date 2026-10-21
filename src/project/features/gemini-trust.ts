import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

// Reads Gemini's own trust records and never writes them: trusting a folder or a hook is the
// user's step. Shapes measured on 0.63.0: trustedFolders.json maps a path to TRUST_FOLDER,
// TRUST_PARENT or DO_NOT_TRUST; trusted_hooks.json maps a project to "name:command" strings.
export interface GeminiTrust {
  readonly folder: "trusted" | "untrusted" | "unknown";
  readonly hooks: "reviewed" | "new" | "none";
}

function readJson(file: string): Record<string, unknown> | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const within = (path: string, base: string) =>
  path === base || path.startsWith(base.endsWith(sep) ? base : `${base}${sep}`);

function folderTrust(root: string, home: string): GeminiTrust["folder"] {
  const folders = readJson(join(home, ".gemini/trustedFolders.json"));
  if (!folders) return "unknown";
  let best: { length: number; trusted: boolean } | null = null;
  for (const [path, value] of Object.entries(folders)) {
    const base =
      value === "TRUST_PARENT" ? dirname(resolve(path)) : resolve(path);
    if (!within(root, base)) continue;
    if (best && best.length > base.length) continue;
    best = { length: base.length, trusted: value !== "DO_NOT_TRUST" };
  }
  return best?.trusted ? "trusted" : "untrusted";
}

function projectedIdentities(root: string): string[] {
  const settings = readJson(join(root, ".gemini/settings.json"));
  const hooks = (settings?.["hooks"] ?? {}) as Record<string, unknown>;
  return Object.values(hooks).flatMap((groups) =>
    (Array.isArray(groups) ? groups : []).flatMap((group) =>
      ((group as { hooks?: { name?: string; command?: string }[] }).hooks ?? [])
        .filter((hook) => hook.name?.startsWith("pmcp-"))
        .map((hook) => `${hook.name}:${hook.command}`),
    ),
  );
}

export function geminiTrust(root: string, home: string): GeminiTrust {
  const identities = projectedIdentities(root);
  const known = readJson(join(home, ".gemini/trusted_hooks.json"));
  const seen = new Set(
    Array.isArray(known?.[root]) ? (known[root] as string[]) : [],
  );
  const folder = folderTrust(root, home);
  if (identities.length === 0) return { folder, hooks: "none" };
  const reviewed = identities.every((identity) => seen.has(identity));
  return { folder, hooks: reviewed ? "reviewed" : "new" };
}
