import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function packageVersions(require, names) {
  const versions = {};
  for (const name of names) {
    let directory = dirname(require.resolve(name));
    while (true) {
      try {
        const manifest = JSON.parse(
          await readFile(join(directory, "package.json"), "utf8"),
        );
        if (manifest.name === name) {
          versions[name] = manifest.version;
          break;
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const parent = dirname(directory);
      if (parent === directory) throw new Error(`Missing manifest for ${name}`);
      directory = parent;
    }
  }
  return versions;
}
