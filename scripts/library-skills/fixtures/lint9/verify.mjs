import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyLint } from "./verify-lint.mjs";

export async function verify({ scratchRoot }) {
  return verifyLint({ scratchRoot, major: 9 });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  console.log(JSON.stringify(await verify({ scratchRoot: process.argv[2] })));
}
