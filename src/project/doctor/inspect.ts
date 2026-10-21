import { join } from "node:path";
import { project } from "../apply.js";
import type { ProjectSpec, Tool } from "../spec.js";
import { opencodeDoctor } from "../adapters/opencode-doctor.js";
import { marketplaceDoctor } from "../marketplaces.js";
import { permissionDoctor } from "../permissions.js";
import { uiClaudeDoctor } from "../ui-claude.js";
import type { Finding } from "./types.js";
import type { DoctorOptions } from "./types.js";
import { listed } from "./_shared.js";
import { claude } from "./claude.js";
import { codex } from "./codex.js";
import { gemini } from "./gemini.js";
import { grok } from "./grok.js";
import { antigravity } from "./antigravity.js";
import { sessionsDoctor } from "./sessions.js";
import { hostDoctor, hostEnvDoctor, ptyBinaryDoctor } from "../host.js";
import { hostApprovalDoctor } from "../host-approval.js";
import { pluginBinaryDoctor } from "../mcp-spec/plugin-binary.js";
export function doctor(spec: ProjectSpec, options: DoctorOptions): Finding[] {
  const check = project(spec, { check: true });
  const findings: Finding[] = [
    check.code === 0
      ? { tool: "project", check: "outputs match sources", status: "ok" }
      : {
          tool: "project",
          check: "outputs match sources",
          status: "fail",
          detail: check.problems.slice(0, 5).join("; "),
        },
  ];
  findings.push(...sessionsDoctor(spec, options));
  findings.push(...hostDoctor(spec));
  if (spec.host) findings.push(hostApprovalDoctor(spec.root));
  if (spec.host) findings.push(ptyBinaryDoctor(process.env));
  findings.push(...hostEnvDoctor(spec, process.env));
  findings.push(...pluginBinaryDoctor(spec.mcp));
  const wanted = (tool: Tool) =>
    spec.tools.has(tool) &&
    (options.only === undefined || options.only.has(tool));
  if (wanted("claude")) findings.push(...claude(spec, options));
  if (wanted("claude")) findings.push(...permissionDoctor(spec));
  if (wanted("claude")) findings.push(...uiClaudeDoctor(spec));
  if (wanted("codex")) findings.push(...codex(spec, options));
  if (wanted("codex")) findings.push(...marketplaceDoctor(spec, options.run));
  if (wanted("gemini")) findings.push(...gemini(spec, options));
  if (wanted("grok")) findings.push(...grok(spec, options));
  if (wanted("opencode"))
    findings.push(...opencodeDoctor(spec, options, listed));
  if (wanted("antigravity")) {
    findings.push(...antigravity(spec, options));
  }
  return findings;
}
