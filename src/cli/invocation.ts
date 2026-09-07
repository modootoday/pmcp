/**
 * How to tell the reader to run us again.
 *
 * The site's own instructions are `npx -y @modootoday/pmcp`, and a reader who
 * followed them has no `pmcp` on PATH. Telling them to run one is a dead end at
 * the moment they were about to do the next thing.
 */

/** npm sets this to `exec` for the process npx spawns. Measured on npm 11.12. */
export function invocation(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return env["npm_command"] === "exec" ? "npx -y @modootoday/pmcp" : "pmcp";
}
