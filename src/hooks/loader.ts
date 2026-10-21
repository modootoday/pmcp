// The projected hook.mjs. It turns on Node's compile cache before loading the body, so the
// body is compiled once per user rather than on every tool call. The cache is an optimisation
// only: when it is missing or unwritable the body runs exactly as it would without it.
// Builtins come from getBuiltinModule because an ESM import builds a facade over each module.
const { enableCompileCache } = process.getBuiltinModule("node:module");
const { homedir } = process.getBuiltinModule("node:os");
const { join } = process.getBuiltinModule("node:path");

function cacheDirectory(): string {
  const base = process.env["XDG_CACHE_HOME"] || join(homedir(), ".cache");
  return join(base, "pmcp", "hook-compile");
}

if (process.env["PMCP_HOOK_COMPILE_CACHE"] !== "off") {
  try {
    enableCompileCache?.(cacheDirectory());
  } catch {
    // An unusable cache only costs the compile.
  }
}

const BODY = new URL("./hook-body.mjs", import.meta.url).href;
const root = join(import.meta.dirname, "../..");

// A body that cannot load fails open, like a hook.mjs that cannot load today.
try {
  const body = (await import(BODY)) as {
    main: (argv: readonly string[], root: string) => Promise<number>;
  };
  process.exitCode = await body.main(process.argv.slice(2), root);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`pmcp hook body did not load: ${message}\n`);
  process.exitCode = 0;
}
