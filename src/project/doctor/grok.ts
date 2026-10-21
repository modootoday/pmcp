import { parse } from "smol-toml";
import { grokTrust } from "../features/grok-trust.js";
import { serversForTool } from "../mcp.js";
import { skillNames } from "../plan.js";
import type { ProjectSpec } from "../spec.js";
import type { Finding } from "./types.js";
import type { DoctorOptions } from "./types.js";
import type { GrokInspect } from "./types.js";
import { missingFrom } from "./_shared.js";
import { verdict } from "./_shared.js";
export function grok(spec: ProjectSpec, o: DoctorOptions): Finding[] {
  const findings = inspect(spec, o);
  if (spec.hookBundle?.policy?.targets.includes("grok"))
    findings.push(hookTrust(spec.root, o.home));
  return findings;
}

// Read from the trust file so the row is right even where grok is not installed.
function hookTrust(root: string, home: string): Finding {
  const check = "hooks: folder trust";
  const trust = grokTrust(root, home);
  if (trust === "trusted")
    return { tool: "grok", check, status: "ok", detail: "folder trusted" };
  return {
    tool: "grok",
    check,
    status: "warn",
    detail: `folder ${trust}; the user runs /hooks-trust in an interactive grok session`,
  };
}

function inspect(spec: ProjectSpec, o: DoctorOptions): Finding[] {
  const result = o.run("grok", ["inspect", "--json"], spec.root);
  if (result.missing)
    return [
      {
        tool: "grok",
        check: "inspect",
        status: "skip",
        detail: "not installed",
      },
    ];
  let report: GrokInspect;
  try {
    report = JSON.parse(
      result.stdout.slice(result.stdout.indexOf("{")),
    ) as GrokInspect;
  } catch {
    return [
      {
        tool: "grok",
        check: "inspect",
        status: "fail",
        detail: "grok inspect --json did not return JSON",
      },
    ];
  }
  const findings: Finding[] = [];
  findings.push(
    report.projectTrusted
      ? { tool: "grok", check: "project trusted", status: "ok" }
      : {
          tool: "grok",
          check: "project trusted",
          status: "fail",
          detail: "untrusted projects skip .grok/ MCP and hooks",
        },
  );
  const skills = new Set((report.skills ?? []).map((s) => s.name));
  findings.push(
    verdict(
      "grok",
      "project skills listed",
      missingFrom(skillNames(spec.root), (n) => skills.has(n)),
    ),
  );
  const leaked = (report.projectInstructions ?? []).filter((i) =>
    i.path.includes("/.claude/rules/"),
  );
  findings.push(
    leaked.length === 0
      ? { tool: "grok", check: "no .claude/rules loaded", status: "ok" }
      : {
          tool: "grok",
          check: "no .claude/rules loaded",
          status: "fail",
          detail: `${leaked.length} rule files load unscoped`,
        },
  );
  const servers = new Set((report.mcpServers ?? []).map((s) => s.name));
  const aliases = serversForTool(spec, "grok").map(([alias]) => alias);
  if (aliases.length > 0) {
    findings.push(
      verdict(
        "grok",
        "mcp servers listed",
        missingFrom(aliases, (n) => servers.has(n)),
      ),
    );
  }
  return findings;
}
