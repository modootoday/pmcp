import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Output } from "../outputs.js";
import { block, getKey, linkOf, readJson, same } from "./_shared.js";

export function present(root: string, output: Output): boolean {
  const abs = join(root, "file" in output ? output.file : output.path);
  switch (output.kind) {
    case "link":
      return linkOf(abs) === output.target;
    case "file":
      return (
        existsSync(abs) &&
        linkOf(abs) === null &&
        readFileSync(abs, "utf8") === output.content
      );
    case "json":
      if (
        output.managed &&
        Array.isArray(output.value) &&
        output.value.length === 0
      ) {
        return getKey(readJson(abs), output.key) === undefined;
      }
      return same(getKey(readJson(abs), output.key), output.value);
    case "block":
      return (
        existsSync(abs) &&
        readFileSync(abs, "utf8").includes(block(output.content))
      );
  }
}
