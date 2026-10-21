import { existsSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import { parse } from "smol-toml";

// Reads grok's folder trust and never writes it: trusting is the user's /hooks-trust step.
// Shape measured on 1.0.50: [folders."<path>"] with trusted = true or false.
export type GrokTrust = "trusted" | "untrusted" | "unknown";

const within = (path: string, base: string) =>
  path === base || path.startsWith(base.endsWith(sep) ? base : `${base}${sep}`);

export function grokTrust(root: string, home: string): GrokTrust {
  const file = join(home, ".grok/trusted_folders.toml");
  if (!existsSync(file)) return "unknown";
  let folders: Record<string, { trusted?: unknown }>;
  try {
    const config = parse(readFileSync(file, "utf8")) as {
      folders?: Record<string, { trusted?: unknown }>;
    };
    folders = config.folders ?? {};
  } catch {
    return "unknown";
  }
  let best: { length: number; trusted: boolean } | null = null;
  for (const [path, entry] of Object.entries(folders)) {
    const base = resolve(path);
    if (!within(root, base)) continue;
    if (best && best.length > base.length) continue;
    best = { length: base.length, trusted: entry.trusted === true };
  }
  return best?.trusted ? "trusted" : "untrusted";
}
