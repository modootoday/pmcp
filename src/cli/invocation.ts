// Preserve npx invocations because those users may have no pmcp executable on PATH.

export function invocation(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return env["npm_command"] === "exec" ? "npx -y @modootoday/pmcp" : "pmcp";
}
