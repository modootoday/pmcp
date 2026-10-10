import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import type { HookTool, ShellHookSpec } from "./hook-spec.js";

type Decision = {
  readonly decision: "allow" | "deny";
  readonly reason?: string;
};
const denied = (): Decision => ({
  decision: "deny",
  reason: "Shell guard failed validation or execution",
});

export function guardPath(root: string, command: readonly string[]): string {
  const script = command[0]?.startsWith(".agents/guards/")
    ? command[0]
    : command[1];
  if (!script?.startsWith(".agents/guards/")) {
    throw new Error("Hook command must execute a script under .agents/guards/");
  }
  const absolute = resolve(root, script);
  const base = resolve(root, ".agents/guards");
  const inside = relative(base, absolute);
  if (
    isAbsolute(inside) ||
    inside === ".." ||
    inside.startsWith("../") ||
    inside.startsWith("..\\")
  ) {
    throw new Error("Hook guard must stay under .agents/guards/");
  }
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    throw new Error("Hook guard script must exist");
  }
  const actual = relative(base, realpathSync(absolute));
  if (
    isAbsolute(actual) ||
    actual === ".." ||
    actual.startsWith("../") ||
    actual.startsWith("..\\")
  ) {
    throw new Error("Hook guard cannot resolve outside .agents/guards/");
  }
  return absolute;
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function scalar(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "string") {
        return parsed;
      }
    } catch {
      return value;
    }
  }
  return value;
}

export function evaluateShellHook(
  root: string,
  policy: ShellHookSpec,
  tool: HookTool,
  payload: unknown,
): Decision {
  try {
    const value = object(payload);
    const call = object(value["toolCall"]);
    const input =
      tool === "antigravity"
        ? object(call["args"])
        : object(value["tool_input"]);
    const name = tool === "antigravity" ? call["name"] : value["tool_name"];
    const shellNames = {
      codex: ["Bash", "exec_command", "shell", "shell_command"],
      gemini: ["run_shell_command"],
      antigravity: ["run_command"],
    };
    if (typeof name !== "string") {
      return denied();
    }
    if (!shellNames[tool].includes(name)) {
      return { decision: "allow" };
    }
    const command = scalar(
      input[tool === "antigravity" ? "CommandLine" : "command"],
    );
    if (command === undefined || command.length > 65536) {
      return denied();
    }
    const cwd = scalar(input["Cwd"]) ?? scalar(value["cwd"]) ?? root;
    const args = [...policy.command];
    const script = guardPath(root, args);
    if (args[0]?.startsWith(".agents/guards/")) {
      args[0] = script;
    } else {
      args[1] = script;
    }
    const executable = args.shift();
    if (!executable) {
      return denied();
    }
    const result = spawnSync(executable, args, {
      cwd: root,
      env: { PATH: process.env["PATH"], LANG: "C.UTF-8" },
      input: JSON.stringify({
        runtime: tool,
        event: "before_shell",
        command,
        cwd,
      }),
      encoding: "utf8",
      timeout: policy.timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: 65536,
    });
    if (result.status !== 0 || result.error) {
      return denied();
    }
    const response = object(JSON.parse(result.stdout));
    if (
      Object.keys(response).some(
        (key) => !["decision", "reason"].includes(key),
      ) ||
      !["allow", "deny"].includes(String(response["decision"])) ||
      (response["reason"] !== undefined &&
        typeof response["reason"] !== "string")
    ) {
      return denied();
    }
    return {
      decision: response["decision"] as Decision["decision"],
      ...(typeof response["reason"] === "string"
        ? { reason: response["reason"].slice(0, 2000) }
        : {}),
    };
  } catch {
    return denied();
  }
}

export function nativeHookDecision(tool: HookTool, decision: Decision): object {
  if (tool === "codex") {
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision.decision,
        ...(decision.reason
          ? { permissionDecisionReason: decision.reason }
          : {}),
      },
    };
  }
  return decision;
}

async function main(): Promise<void> {
  const [, , , tool, file, integrity] = process.argv;
  const supported =
    tool === "codex" || tool === "gemini" || tool === "antigravity";
  if (!supported) {
    process.exitCode = 2;
    return;
  }
  let decision = denied();
  try {
    if (!file) {
      throw new Error("Missing hook policy");
    }
    const bytes = readFileSync(file);
    const adapter = readFileSync(process.argv[1]!);
    const actual = createHash("sha256")
      .update(adapter)
      .update(bytes)
      .digest("hex");
    if (actual !== integrity) {
      throw new Error("Hook integrity mismatch");
    }
    const policy = JSON.parse(bytes.toString("utf8")) as ShellHookSpec & {
      contractVersion: number;
      guardSha256: string;
    };
    if (!policy.targets.includes(tool)) {
      throw new Error("Hook target mismatch");
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > 131072) {
        throw new Error("Hook input too large");
      }
      chunks.push(bytes);
    }
    const root = resolve(dirname(file), "../..");
    const guardSha256 = createHash("sha256")
      .update(readFileSync(guardPath(root, policy.command)))
      .digest("hex");
    if (policy.contractVersion !== 1 || guardSha256 !== policy.guardSha256) {
      throw new Error(
        "Hook guard source changed; reproject and review native trust",
      );
    }
    decision = evaluateShellHook(
      root,
      policy,
      tool,
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
  } catch {
    decision = denied();
  }
  process.stdout.write(
    `${JSON.stringify(nativeHookDecision(tool, decision))}\n`,
  );
}

if (process.argv[2] === "--pmcp-shell-hook") {
  await main();
}
