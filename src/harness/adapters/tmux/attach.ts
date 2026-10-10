import { spawn } from "node:child_process";
import type { Receipt } from "../../contracts.js";
import { text } from "../../validation.js";

export async function attachNative(
  spec: Receipt,
  renew?: () => void,
): Promise<Receipt> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("attach_requires_terminal");
  const socket = text(spec.socket, "socket");
  const session = text(spec.session, "session");
  const args = ["-S", socket, "attach-session", "-E", "-t", session];
  if (spec.readOnly === true) args.push("-r");
  const env = { ...process.env };
  delete env.TMUX;
  const client = spawn("tmux", args, { stdio: "inherit", env });
  let renewalError: unknown;
  const timer = renew
    ? setInterval(() => {
        try {
          renew();
        } catch (error) {
          renewalError = error;
          client.kill("SIGTERM");
        }
      }, 20_000)
    : undefined;
  let exitCode: number;
  try {
    exitCode = await new Promise<number>((resolve, reject) => {
      client.once("error", reject);
      client.once("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    if (timer) clearInterval(timer);
  }
  if (renewalError) throw renewalError;
  if (exitCode !== 0) throw new Error("attach_failed");
  return {
    detached: true,
    runtimeStopRequested: false,
    readOnly: spec.readOnly === true,
  };
}
