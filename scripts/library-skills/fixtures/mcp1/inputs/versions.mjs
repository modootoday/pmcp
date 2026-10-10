import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function readPackageVersion(require, packageName, entry) {
  let directory = dirname(require.resolve(entry));
  while (true) {
    try {
      const manifest = JSON.parse(
        await readFile(join(directory, "package.json"), "utf8"),
      );
      if (manifest.name === packageName) return manifest.version;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error(`Cannot locate the manifest for ${packageName}`);
    directory = parent;
  }
}
