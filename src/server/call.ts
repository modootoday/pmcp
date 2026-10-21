import { readFileSync } from "node:fs";
import { readBody } from "../catalog.js";
import { bundleSkill } from "../files/bundle.js";
import { servedBytes } from "../files/redact.js";
import { ownFile } from "../files/resolve.js";
import type { CallResponse } from "./types.js";
import type { ToolsContext } from "./types.js";
export function callOperation(
  context: ToolsContext,
  name: string,
): CallResponse | null {
  const { options, catalog, byName } = context;
  const entry = byName(name);
  if (!entry) return null;
  const bundle = bundleSkill(entry);
  const own = ownFile(entry);
  return {
    name: entry.name,
    body: readBody(
      servedBytes(entry.path, readFileSync(entry.path)).toString("utf8"),
    ),
    files: bundle.files.filter((file) => file.path !== own),
    filesTruncated: bundle.truncated,
  };
}
