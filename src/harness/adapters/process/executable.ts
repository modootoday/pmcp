import { accessSync, constants, statSync } from "node:fs";
import { delimiter, resolve } from "node:path";

export function locateExecutable(
  binary: string,
  cwd = process.cwd(),
): string | null {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const path = resolve(cwd, directory, binary);
    try {
      if (!statSync(path).isFile()) continue;
      accessSync(path, constants.X_OK);
      return path;
    } catch {
      continue;
    }
  }
  return null;
}
