import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function publicMarketplaceRoot(
  start = dirname(fileURLToPath(import.meta.url)),
): string {
  let directory = start;
  for (;;) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) {
      const value: unknown = JSON.parse(readFileSync(manifest, "utf8"));
      if (
        value !== null &&
        typeof value === "object" &&
        "name" in value &&
        value.name === "@modootoday/pmcp"
      )
        return directory;
    }
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error("Cannot locate the bundled PMCP marketplace");
    directory = parent;
  }
}
