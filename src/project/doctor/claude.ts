import { serversForTool } from "../mcp.js";
import type { ProjectSpec } from "../spec.js";
import type { Finding } from "./types.js";
import type { DoctorOptions } from "./types.js";
import { listed } from "./_shared.js";
import { lines } from "./_shared.js";
export function claude(spec: ProjectSpec, o: DoctorOptions): Finding[] {
  const aliases = serversForTool(spec, "claude").map(([alias]) => alias);
  if (aliases.length === 0) return [];
  const result = o.run("claude", ["mcp", "list"], spec.root);
  return [
    listed("claude", "mcp servers connected", result, aliases, (out, alias) =>
      lines(out).some(
        (l) =>
          l.startsWith(`${alias}:`) &&
          /connected/iu.test(l) &&
          !/failed/iu.test(l),
      ),
    ),
  ];
}
