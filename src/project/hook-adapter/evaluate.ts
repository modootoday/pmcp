import { spawnSync } from "node:child_process";
import type { HookTool, ShellHookSpec } from "../hook-spec.js";
import type { Decision } from "./types.js";
import { denied } from "./_shared.js";
import { object } from "./_shared.js";
import { scalar } from "./_shared.js";
import { guardPath } from "./path.js";
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
    const afterEdit = policy.event === "after_edit";
    if (afterEdit && tool !== "codex") {
      return denied();
    }
    const matches = afterEdit
      ? name === "apply_patch"
      : shellNames[tool].includes(name);
    if (!matches) {
      return { decision: "allow" };
    }
    const command = scalar(
      input[tool === "antigravity" ? "CommandLine" : "command"],
    );
    const limit = afterEdit ? 16 * 1024 * 1024 : 65536;
    if (command === undefined || command.length > limit) {
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
        event: afterEdit ? "after_edit" : "before_shell",
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
