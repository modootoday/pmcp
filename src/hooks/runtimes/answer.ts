// A before_tool answer read back as the verdict it carries, for smoke runs. Each adapter names
// the fields; nothing printed is allow, and text that is not a JSON object is unreadable (null).
export type ReadVerdict = "allow" | "deny" | "ask";

export function readAnswer(
  stdout: string,
  pick: (out: Record<string, unknown>) => ReadVerdict,
): ReadVerdict | null {
  const text = stdout.trim();
  if (!text) return "allow";
  try {
    const out: unknown = JSON.parse(text);
    if (!out || typeof out !== "object" || Array.isArray(out)) return null;
    return pick(out as Record<string, unknown>);
  } catch {
    return null;
  }
}

export function field(value: unknown, key: string): unknown {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)[key]
    : undefined;
}
