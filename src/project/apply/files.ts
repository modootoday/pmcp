import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Output } from "../outputs.js";
import { replaceFile, replaceLink } from "../write.js";
import { present } from "./present.js";

export function writeFiles(root: string, outputs: readonly Output[]): void {
  for (const output of outputs) {
    if (output.kind !== "link" && output.kind !== "file") continue;
    if (present(root, output)) continue;
    const abs = join(root, output.path);
    mkdirSync(dirname(abs), { recursive: true });
    if (output.kind === "link") {
      replaceLink(abs, output.target);
      continue;
    }
    replaceFile(abs, output.content);
  }
}
