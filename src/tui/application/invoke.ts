import type { Receipt } from "../../harness/contracts.js";
import type { TuiInvocation } from "../../commands/tui/invocation.js";
import { dependencies } from "../adapters/process/runtime.js";
import { serializedView } from "../adapters/process/lock.js";
import { createView } from "./create.js";
import { operate } from "./operations.js";
import { openView } from "./context.js";
import { describeFailure } from "./feedback.js";

export async function invokeTui(invocation: TuiInvocation): Promise<Receipt> {
  if (invocation.action === "doctor")
    return { schemaVersion: 1, ok: true, ...dependencies() };
  if (invocation.action === "create") return createView(invocation.create!);
  if (invocation.action === "inspect")
    return operate("inspect", invocation.viewFile!);
  if (
    invocation.action === "open" &&
    (!process.stdin.isTTY || !process.stdout.isTTY)
  )
    throw new Error("terminal_required");
  const receipt = serializedView(invocation);
  if (receipt.ok !== true || invocation.action !== "open") return receipt;
  const context = openView(invocation.viewFile!);
  try {
    const exitCode = await context.renderer.connection.attach(context.view);
    return {
      schemaVersion: 1,
      ok: exitCode === 0,
      detached: true,
      exitCode,
      runtimeStopRequested: false,
    };
  } finally {
    try {
      serializedView({ ...invocation, action: "disconnect" });
    } catch {}
  }
}

export function failedInvocation(action: string, error: unknown): Receipt {
  const failure = describeFailure(action, error);
  return {
    schemaVersion: 1,
    ok: false,
    error: failure.code,
    hint: failure.hint,
    inputReplayed: false,
  };
}
