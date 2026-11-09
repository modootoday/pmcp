// [budgets]: byte and line limits per path glob, kept in pmcp.toml as the one place for the
// numbers. pmcp validates them and judges none; another checker reads the table and a
// [[hooks.guards.external]] guard runs it on edits.

export interface FileBudget {
  readonly bytes?: number;
  readonly lines?: number;
}

const FIELDS = ["bytes", "lines"];

function readEntry(glob: string, value: unknown): FileBudget {
  const where = `[budgets] "${glob}"`;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${where} must be a table such as { bytes = 4096 }`);
  const entry = value as Record<string, unknown>;
  const unknown = Object.keys(entry).find((key) => !FIELDS.includes(key));
  if (unknown) throw new Error(`${where}: unknown key ${unknown}`);
  const limit = (key: "bytes" | "lines"): number | undefined => {
    const raw = entry[key];
    if (raw === undefined) return undefined;
    if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 1)
      throw new Error(`${where}: ${key} must be a whole number from 1`);
    return raw;
  };
  const bytes = limit("bytes");
  const lines = limit("lines");
  if (bytes === undefined && lines === undefined)
    throw new Error(`${where}: set bytes, lines or both`);
  return {
    ...(bytes !== undefined ? { bytes } : {}),
    ...(lines !== undefined ? { lines } : {}),
  };
}

export function readBudgets(value: unknown): Record<string, FileBudget> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("[budgets] must be a table of glob = { bytes, lines }");
  const out: Record<string, FileBudget> = {};
  for (const [glob, entry] of Object.entries(value)) {
    if (glob === "" || glob.startsWith("/") || glob.split("/").includes(".."))
      throw new Error(`[budgets] "${glob}" must be a glob inside the project`);
    out[glob] = readEntry(glob, entry);
  }
  return out;
}
