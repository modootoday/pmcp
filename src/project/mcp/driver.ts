import { isAbsolute, relative } from "node:path";
import type { ProjectSpec } from "../spec.js";
import { launch } from "./launch.js";
import { ROOT_VAR } from "./_shared.js";

export function proxyDriver(spec: ProjectSpec, alias: string) {
  const entry = relative(spec.root, process.argv[1] ?? "");
  if (!isAbsolute(entry) && !entry.startsWith("..")) {
    return launch({
      command: "node",
      args: [`${ROOT_VAR}/${entry}`, "project", "exec-mcp", alias],
      env: {},
    });
  }
  return launch({
    command: "pmcp",
    args: ["project", "exec-mcp", alias],
    env: {},
  });
}
