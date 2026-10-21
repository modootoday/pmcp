import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (path: string) =>
  JSON.parse(readFileSync(join(root, path), "utf8"));

// 0.18.0 shipped a bridge plugin and Gemini extension that still started 0.13.1 from a pinned
// constant; every bridge manifest must start the release it ships in.
it("starts the release it ships in from every bridge manifest", () => {
  const bridge = [
    "-y",
    `@modootoday/pmcp@${read("package.json").version}`,
    "serve",
  ];
  for (const dir of ["", "plugins/pmcp/"])
    for (const path of ["mcp.json", ".mcp.json", "gemini-extension.json"])
      expect(read(dir + path).mcpServers.pmcp.args, dir + path).toEqual(bridge);
});
