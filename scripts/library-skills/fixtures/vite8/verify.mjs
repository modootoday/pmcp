import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { verifyBuild } from "../vite7/verify-build.mjs";

export async function verify({ scratchRoot }) {
  return verifyBuild({
    scratchRoot,
    sourceRoot: fileURLToPath(new URL("./project/", import.meta.url)),
    major: 8,
    tailwind: true,
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  console.log(JSON.stringify(await verify({ scratchRoot: process.argv[2] })));
}
