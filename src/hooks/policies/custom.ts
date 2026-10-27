// Pin custom guard hashes so changed scripts require a new reviewed projection. An installed
// program is pinned by the version it reports instead, checked at projection and by doctor.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import type { CompiledCustom } from "../compiled.js";
import type { Decision, HookInput, Mode, NeutralEvent } from "../contract.js";
import type { Logger } from "../../logging/logger.js";
import { pass, type Policy } from "./types.js";

const FAILED = "Guard failed validation or execution";
// What a guard's request names, so a guard can refuse a contract it does not know.
export const GUARD_PROTOCOL = "pmcp.guard.v1";
const MAX_FINDINGS = 20;
const MAX_REASON = 2000;

export type CustomEvent = CompiledCustom["event"];

// The neutral event each custom event listens on, and the tool a tool event is narrowed to.
const EVENTS: Readonly<
  Record<CustomEvent, { event: NeutralEvent; tool?: "shell" | "edit" }>
> = {
  before_shell: { event: "before_tool", tool: "shell" },
  after_edit: { event: "after_tool", tool: "edit" },
  stop: { event: "stop" },
  session_start: { event: "session_start" },
  prompt: { event: "prompt" },
};

export function customEvent(event: CustomEvent): NeutralEvent {
  return EVENTS[event].event;
}

// A session cannot be refused at its start, so a refusing mode there tells the session instead.
export function customMode(entry: CompiledCustom): Mode {
  const mode = entry.mode ?? "deny";
  return entry.event === "session_start" && (mode === "deny" || mode === "ask")
    ? "warn"
    : mode;
}

function inside(base: string, path: string): boolean {
  const rest = relative(base, path);
  return rest !== "" && !rest.startsWith("..") && !isAbsolute(rest);
}

export function namesScript(command: readonly string[]): boolean {
  return [command[0], command[1]].some((part) =>
    part?.startsWith(".agents/guards/"),
  );
}

export function guardScript(root: string, command: readonly string[]): string {
  const script = command[0]?.startsWith(".agents/guards/")
    ? command[0]
    : command[1];
  if (!script?.startsWith(".agents/guards/")) {
    throw new Error(
      "Hook command must execute a script under .agents/guards/, or name an installed program with version",
    );
  }
  const base = resolve(root, ".agents/guards");
  if (!inside(base, resolve(root, script)))
    throw new Error("Hook guard must stay under .agents/guards/");
  if (!existsSync(resolve(root, script)))
    throw new Error("Hook guard script must exist");
  const real = realpathSync(resolve(root, script));
  if (!inside(realpathSync(base), real))
    throw new Error("Hook guard cannot resolve outside .agents/guards/");
  return real;
}

export function guardHash(root: string, command: readonly string[]): string {
  return createHash("sha256")
    .update(readFileSync(guardScript(root, command)))
    .digest("hex");
}

// What `<program> --version` prints, or null when it does not run.
export function programVersion(
  program: string,
  root: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const run = spawnSync(program, ["--version"], {
    cwd: root,
    env: { PATH: env["PATH"], LANG: "C.UTF-8" },
    encoding: "utf8",
    timeout: 10_000,
    killSignal: "SIGKILL",
    maxBuffer: 65536,
  });
  if (run.error || run.status !== 0) return null;
  return `${run.stdout}${run.stderr}`.trim();
}

// The pinned version as a whole token of the output: 1.2.3 matches "tool 1.2.3", not 1.2.30.
export function versionMatches(output: string, version: string): boolean {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `(?:^|[^0-9A-Za-z.])v?${escaped}(?:$|[^0-9A-Za-z.])`,
    "u",
  ).test(output);
}

function applies(entry: CompiledCustom, input: HookInput): boolean {
  if (!entry.targets.includes(input.runtime)) return false;
  const { event, tool } = EVENTS[entry.event];
  return input.event === event && (!tool || input.tool?.kind === tool);
}

interface Finding {
  readonly path?: string;
  readonly line?: number;
  readonly message: string;
}

function readFindings(value: unknown): Finding[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const found: Finding[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const { path, line, message, ...rest } = item as Record<string, unknown>;
    if (Object.keys(rest).length > 0 || typeof message !== "string")
      return null;
    if (path !== undefined && typeof path !== "string") return null;
    if (
      line !== undefined &&
      (!Number.isSafeInteger(line) || (line as number) < 1)
    )
      return null;
    found.push({
      message,
      ...(path !== undefined ? { path } : {}),
      ...(line !== undefined ? { line: line as number } : {}),
    });
  }
  return found;
}

function findingLine(finding: Finding): string {
  const where = finding.path
    ? `${finding.path}${finding.line ? `:${finding.line}` : ""}: `
    : "";
  return `${where}${finding.message}`;
}

function request(entry: CompiledCustom, input: HookInput): string {
  return JSON.stringify({
    protocol: GUARD_PROTOCOL,
    runtime: input.runtime,
    event: entry.event,
    session: input.session.id,
    command: input.tool?.command ?? "",
    cwd: input.cwd,
    paths: input.tool?.paths ?? [],
    ...(entry.event === "prompt" ? { prompt: input.prompt ?? "" } : {}),
  });
}

function run(entry: CompiledCustom, input: HookInput, log: Logger): Decision {
  const root = input.projectRoot;
  if (
    entry.guardSha256 !== undefined &&
    guardHash(root, entry.command) !== entry.guardSha256
  ) {
    return {
      verdict: "deny",
      reason: "Guard source changed; review it and run pmcp project",
    };
  }
  const args = entry.command.map((part) =>
    part.startsWith(".agents/guards/") ? resolve(root, part) : part,
  );
  const result = spawnSync(args[0]!, args.slice(1), {
    cwd: root,
    env: { PATH: process.env["PATH"], LANG: "C.UTF-8" },
    input: request(entry, input),
    encoding: "utf8",
    timeout: entry.timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: 65536,
  });
  if (result.status !== 0 || result.error)
    return { verdict: "deny", reason: FAILED };
  const response = JSON.parse(result.stdout) as Record<string, unknown>;
  const extra = Object.keys(response).some(
    (key) => !["decision", "reason", "findings", "protocol"].includes(key),
  );
  const reason = response["reason"];
  const findings = readFindings(response["findings"]);
  if (
    extra ||
    findings === null ||
    (reason !== undefined && typeof reason !== "string") ||
    (response["protocol"] !== undefined &&
      response["protocol"] !== GUARD_PROTOCOL)
  )
    return { verdict: "deny", reason: FAILED };
  const lines = findings.slice(0, MAX_FINDINGS).map(findingLine);
  if (findings.length > MAX_FINDINGS)
    lines.push(`and ${findings.length - MAX_FINDINGS} more`);
  if (lines.length > 0)
    log.info("guard findings", {
      decision: String(response["decision"]),
      findings: findings.length,
    });
  if (response["decision"] === "allow")
    return lines.length > 0
      ? { context: [`pmcp custom.${entry.name}:\n${lines.join("\n")}`] }
      : pass;
  if (response["decision"] !== "deny")
    return { verdict: "deny", reason: FAILED };
  const text = [typeof reason === "string" ? reason : FAILED, ...lines].join(
    "\n",
  );
  return { verdict: "deny", reason: text.slice(0, MAX_REASON) };
}

export function customPolicy(entry: CompiledCustom): Policy<object> {
  const { event, tool } = EVENTS[entry.event];
  return {
    id: `custom.${entry.name}`,
    events: [event],
    ...(tool ? { tools: [tool] } : {}),
    fail: "closed",
    defaultMode: "deny",
    options: () => ({}),
    evaluate: (input, ctx) =>
      applies(entry, input) ? run(entry, input, ctx.log) : pass,
  };
}
