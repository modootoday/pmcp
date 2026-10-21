import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verify } from "./verify/run.mjs";
export { verify };
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = await verify({
    scratchRoot: process.argv[2],
    redisUrl: process.argv[3],
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
