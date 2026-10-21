import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ShellHookSpec } from "../hook-spec.js";
import { denied } from "./_shared.js";
import { guardPath } from "./path.js";
import { evaluateShellHook } from "./evaluate.js";
import { nativeHookDecision } from "./render.js";
export async function main(): Promise<void> {
  const [, , , tool, file, integrity, event] = process.argv;
  const afterEdit = event === "after_edit";
  const supported =
    tool === "codex" || tool === "gemini" || tool === "antigravity";
  if (!supported) {
    process.exitCode = 2;
    return;
  }
  let decision = denied();
  try {
    if (event !== undefined && !afterEdit) {
      throw new Error("Unknown hook event");
    }
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
    if (!policy.targets.includes(tool) || policy.event !== event) {
      throw new Error("Hook target mismatch");
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > (afterEdit ? 16 * 1024 * 1024 : 131072)) {
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
    `${JSON.stringify(nativeHookDecision(tool, decision, afterEdit ? "after_edit" : undefined))}\n`,
  );
}
