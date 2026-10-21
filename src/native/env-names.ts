// Environment a pmcp-started runtime needs from the person or service starting it (a cloud
// project, a region), declared by name only: pmcp.toml, approvals and journals never hold a
// value, and the values are read from the starting process at the moment of each start.

const NAME = /^[A-Z_][A-Z0-9_]{0,127}$/u;

// pmcp-pty sets these itself for every session, after the request's env.
const RESERVED = ["PMCP_PTY_SOCKET", "PMCP_PTY_SESSION", "PMCP_PTY_INSTANCE"];

export function envNames(value: unknown, where: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new Error(`${where} must be a list of environment variable names`);
  const names = value.map((name, i) => {
    if (typeof name !== "string" || !NAME.test(name))
      throw new Error(
        `${where}[${i}] must be an environment variable name (A-Z, 0-9, _)`,
      );
    if (RESERVED.includes(name))
      throw new Error(`${where}[${i}] ${name} is set by pmcp-pty itself`);
    return name;
  });
  return [...new Set(names)];
}

export interface PickedEnv {
  readonly values: Record<string, string>;
  readonly missing: readonly string[];
}

// The declared names' values from env; a name that is unset or empty is missing, so a session
// is refused instead of started without what it needs (a runtime then waits for a login).
export function pickEnv(
  names: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): PickedEnv {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of names) {
    const value = env[name];
    if (value === undefined || value === "") missing.push(name);
    else values[name] = value;
  }
  return { values, missing };
}
