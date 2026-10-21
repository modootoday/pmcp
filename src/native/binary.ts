import { accessSync, constants, statSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join } from "node:path";

type Env = Readonly<Record<string, string | undefined>>;

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export type Packaged = { path: string } | { reason: string };

// The platform package npm installed through optionalDependencies (scripts/platform-packages.mjs),
// resolved from this package so it works for local, global and npx installs alike.
export function packagedBinary(
  name: string,
  from: string = import.meta.url,
): Packaged {
  const platform = `pmcp-${process.platform}-${process.arch}`;
  let manifest: string;
  try {
    manifest = createRequire(from).resolve(
      `@modootoday/${platform}/package.json`,
    );
  } catch {
    return { reason: `no @modootoday/${platform} package is installed` };
  }
  const path = join(dirname(manifest), "bin", name);
  return executable(path)
    ? { path }
    : { reason: `@modootoday/${platform} has no ${name}` };
}

function packaged(name: string): string | null {
  const found = packagedBinary(name);
  return "path" in found ? found.path : null;
}

// A native pmcp binary: the override variable when set (and only it), else the platform
// package, else the first one on PATH; null when none is an executable.
export function nativeBinary(
  name: string,
  variable: string,
  env: Env,
): string | null {
  const given = env[variable];
  if (given) return executable(given) ? given : null;
  const found = packaged(name);
  if (found) return found;
  for (const dir of (env["PATH"] ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(dir, name);
    if (executable(candidate)) return candidate;
  }
  return null;
}
