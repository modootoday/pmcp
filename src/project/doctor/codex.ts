import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";
import { serversForTool } from "../mcp.js";
import type { ProjectSpec } from "../spec.js";
import type { Finding } from "./types.js";
import type { DoctorOptions } from "./types.js";
import { listed } from "./_shared.js";
import { lines } from "./_shared.js";
export function codex(spec: ProjectSpec, o: DoctorOptions): Finding[] {
  const findings: Finding[] = [];
  const config = join(o.home, ".codex/config.toml");
  let trusted = false;
  if (existsSync(config)) {
    const projects =
      (
        parse(readFileSync(config, "utf8")) as {
          projects?: Record<
            string,
            {
              trust_level?: string;
            }
          >;
        }
      ).projects ?? {};
    const root = spec.root.replace(/\/$/u, "");
    trusted =
      projects[root]?.trust_level === "trusted" ||
      projects[`${root}/`]?.trust_level === "trusted";
  }
  findings.push(
    trusted
      ? { tool: "codex", check: "project trusted", status: "ok" }
      : {
          tool: "codex",
          check: "project trusted",
          status: "fail",
          detail: "untrusted projects skip .codex/ and .agents/",
        },
  );
  const aliases = serversForTool(spec, "codex").map(([alias]) => alias);
  if (aliases.length > 0) {
    const result = o.run("codex", ["mcp", "list"], spec.root);
    findings.push(
      listed("codex", "mcp servers listed", result, aliases, (out, alias) =>
        lines(out).some((l) => l.split(/\s+/u)[0] === alias),
      ),
    );
  }
  return findings;
}
