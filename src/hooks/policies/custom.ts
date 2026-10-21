// Pin custom guard hashes so changed scripts require a new reviewed projection.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import type { CompiledCustom } from "../compiled.js";
import type { Decision, HookInput } from "../contract.js";
import { pass, type Policy } from "./types.js";

const FAILED = "Guard failed validation or execution";

function inside(base: string, path: string): boolean {
  const rest = relative(base, path);
  return rest !== "" && !rest.startsWith("..") && !isAbsolute(rest);
}

export function guardScript(root: string, command: readonly string[]): string {
  const script = command[0]?.startsWith(".agents/guards/")
    ? command[0]
    : command[1];
  if (!script?.startsWith(".agents/guards/")) {
    throw new Error("Hook command must execute a script under .agents/guards/");
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

function applies(entry: CompiledCustom, input: HookInput): boolean {
  if (!entry.targets.includes(input.runtime)) return false;
  if (entry.event === "before_shell")
    return input.event === "before_tool" && input.tool?.kind === "shell";
  return input.event === "after_tool" && input.tool?.kind === "edit";
}

function run(entry: CompiledCustom, input: HookInput): Decision {
  const root = input.projectRoot;
  if (guardHash(root, entry.command) !== entry.guardSha256) {
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
    input: JSON.stringify({
      runtime: input.runtime,
      event: entry.event,
      command: input.tool?.command ?? "",
      cwd: input.cwd,
      paths: input.tool?.paths ?? [],
    }),
    encoding: "utf8",
    timeout: entry.timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: 65536,
  });
  if (result.status !== 0 || result.error)
    return { verdict: "deny", reason: FAILED };
  const response = JSON.parse(result.stdout) as Record<string, unknown>;
  const extra = Object.keys(response).some(
    (key) => key !== "decision" && key !== "reason",
  );
  const reason = response["reason"];
  if (extra || (reason !== undefined && typeof reason !== "string"))
    return { verdict: "deny", reason: FAILED };
  if (response["decision"] === "allow") return pass;
  if (response["decision"] !== "deny")
    return { verdict: "deny", reason: FAILED };
  return {
    verdict: "deny",
    reason: typeof reason === "string" ? reason.slice(0, 2000) : FAILED,
  };
}

export function customPolicy(entry: CompiledCustom): Policy<object> {
  return {
    id: `custom.${entry.name}`,
    events: [entry.event === "before_shell" ? "before_tool" : "after_tool"],
    tools: [entry.event === "before_shell" ? "shell" : "edit"],
    fail: "closed",
    defaultMode: "deny",
    options: () => ({}),
    evaluate: (input) => (applies(entry, input) ? run(entry, input) : pass),
  };
}
