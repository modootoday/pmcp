import { spawn } from "node:child_process";
import { ptyBinary } from "../../../project/host.js";
import type { Receipt } from "../../contracts.js";
import { text } from "../../validation.js";

// The person's terminal attaches to the session through pmcp-pty; a writable attach carries the
// harness lease token, without which pmcp-pty refuses it. Ctrl-\ twice detaches.
export async function attachNative(
  spec: Receipt,
  renew?: () => void,
): Promise<Receipt> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("attach_requires_terminal");
  const socket = text(spec.socket, "socket");
  const session = text(spec.session, "session");
  const binary = ptyBinary(process.env);
  if (!binary) throw new Error("terminal_host_missing");
  const args = ["attach", session, "--socket", socket];
  if (spec.readOnly === true) args.push("--read-only");
  else args.push("--lease", text(spec.lease, "lease"));
  const client = spawn(binary, args, { stdio: "inherit" });
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
