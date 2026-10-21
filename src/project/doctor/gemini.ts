import { geminiTrust } from "../features/gemini-trust.js";
import { serversForTool } from "../mcp.js";
import { skillNames } from "../plan.js";
import type { ProjectSpec } from "../spec.js";
import type { Finding } from "./types.js";
import type { DoctorOptions } from "./types.js";
import { listed } from "./_shared.js";
import { lines } from "./_shared.js";
export function geminiConnected(out: string, alias: string): boolean {
  const sections = out.split(
    /(?=^[^\p{L}\p{N}\r\n]*[A-Za-z0-9][A-Za-z0-9_-]*:\s)/gmu,
  );
  const header = new RegExp(`^[^\\p{L}\\p{N}\\r\\n]*${alias}:\\s`, "mu");
  const section = sections.find((entry) => header.test(entry));
  if (section === undefined) {
    return false;
  }
  const statuses = [
    ...section.matchAll(/\s-\s+(Connected|Disconnected)\s*$/gimu),
  ];
  return statuses.at(-1)?.[1]?.toLowerCase() === "connected";
}
export function gemini(spec: ProjectSpec, o: DoctorOptions): Finding[] {
  const findings: Finding[] = [];
  const skills = skillNames(spec.root);
  if (skills.length > 0) {
    const result = o.run("gemini", ["skills", "list"], spec.root);
    findings.push(
      listed("gemini", "project skills listed", result, skills, (out, name) =>
        lines(out).some((l) => l.startsWith(`${name} [`)),
      ),
    );
  }
  const aliases = serversForTool(spec, "gemini").map(([alias]) => alias);
  if (aliases.length > 0) {
    const result = o.run("gemini", ["mcp", "list"], spec.root);
    findings.push(
      listed(
        "gemini",
        "mcp servers connected",
        result,
        aliases,
        geminiConnected,
      ),
    );
  }
  if (spec.hookBundle?.policy?.targets.includes("gemini"))
    findings.push(hookTrust(spec.root, o.home));
  return findings;
}

// Gemini ignores project settings, and so the hooks, in a folder the user has not trusted.
function hookTrust(root: string, home: string): Finding {
  const check = "hooks: folder trust";
  const trust = geminiTrust(root, home);
  const detail = `folder ${trust.folder}, hooks ${trust.hooks}`;
  if (trust.folder === "trusted")
    return { tool: "gemini", check, status: "ok", detail };
  const hint = "the user trusts this folder in an interactive gemini session";
  return {
    tool: "gemini",
    check,
    status: "warn",
    detail: `${detail}; ${hint}`,
  };
}
