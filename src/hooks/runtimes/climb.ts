// Shared by the runtimes whose hooks find the project themselves. The command walks up from the
// hook process's real directory with cd and $(pwd -P) and names no shell variable: an inherited
// $PWD can be stale, and Gemini expands $NAME from its own environment when it loads settings.json,
// which would bake the launch directory into the command and its trusted-hook identity.
// start: a directory the runtime names for its project, tried before the hook's own directory.
export function climbCommand(
  run: string,
  missing?: string,
  start?: string,
): string {
  const skip = `echo "pmcp: no pmcp.toml at or above $(pwd -P); hook skipped" >&2`;
  const from = start ? `cd ${start} 2>/dev/null; ` : "";
  return (
    `${from}cd "$(pwd -P)" && while [ ! -f pmcp.toml ] && [ "$(pwd)" != / ]; do cd ..; done; ` +
    `if [ -f pmcp.toml ]; then exec ${run}; fi; ${skip}` +
    (missing ? `; ${missing}` : "")
  );
}

export const HOOK_PATH = ".agents/pmcp-hooks/hook.mjs";
