import { parseArgs } from "../../cli/command.js";
import { parseTui, tuiOptions } from "../../commands/tui/invocation.js";
import type { Action, PanelRole } from "../contracts.js";
import { readView } from "../state/store.js";
import { CommonHarness } from "./common.js";
import { waitFor } from "./context.js";
import { runPanel } from "../presentation/panel.js";
import { operate } from "./operations.js";
import { invokeTui, failedInvocation } from "./invoke.js";
import { recordCallbackFailure } from "./feedback.js";
import { TmuxView } from "../adapters/tmux/view.js";
import { prepareWorkspace } from "../startup/workspace.js";
import type { StartupRequest } from "../startup/config.js";

const [role, ...argv] = process.argv.slice(2);
const callback = argv.includes("--callback");
try {
  if (role === "startup") {
    const [encoded, ...extra] = argv;
    if (
      !encoded ||
      extra.length ||
      encoded.length > 16_384 ||
      !/^[A-Za-z0-9_-]+$/.test(encoded)
    )
      throw new Error("invalid_startup_arguments");
    const request = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as StartupRequest;
    if (typeof request.cwd !== "string" || !request.cwd)
      throw new Error("invalid_startup_arguments");
    const result = await prepareWorkspace(request);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (role === "attach") {
    const [file, sessionId, leaseFile] = argv;
    if (!file || !sessionId) throw new Error("invalid_attachment_arguments");
    await waitFor(() => {
      try {
        readView(file);
        return true;
      } catch {
        return false;
      }
    }, 5000);
    const { view } = readView(file);
    if (view.state !== "open") throw new Error("view_closed");
    await new CommonHarness(view).call("attach", "open", {
      sessionId,
      mode: leaseFile ? "write" : "observe",
      leaseFile,
    });
  } else if (role === "panel") {
    const [file, panel] = argv;
    if (
      !file ||
      !panel ||
      !["dock", "coordination", "management", "history", "mailbox"].includes(
        panel,
      )
    )
      throw new Error("invalid_panel_arguments");
    await runPanel(file, panel as PanelRole);
  } else if (role === "locked" || role === "action") {
    const invocation = parseTui(
      parseArgs(
        argv.filter((arg) => arg !== "--callback"),
        tuiOptions,
      ),
    );
    if (
      [
        "create",
        "doctor",
        "launch",
        "plan",
        "recovery",
        "start-worker",
      ].includes(invocation.action)
    )
      throw new Error("unsupported_worker_operation");
    const result =
      role === "locked"
        ? await operate(
            invocation.action as Action,
            invocation.viewFile!,
            invocation.input,
          )
        : await invokeTui(invocation);
    if (!callback) process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = callback || result.ok === true ? 0 : 1;
  } else {
    throw new Error("unsupported_worker_role");
  }
} catch (error) {
  if (callback) {
    const index = argv.indexOf("--view");
    const file = argv[index + 1];
    if (index >= 0 && file) {
      try {
        recordCallbackFailure(file, argv[0] ?? "callback", error);
        const { view } = readView(file);
        if (view.state === "open") new TmuxView(view, file).status(view);
      } catch {}
    }
  }
  if (!callback)
    process.stdout.write(
      `${JSON.stringify(failedInvocation(role ?? "worker", error))}\n`,
    );
  process.exitCode = callback ? 0 : 1;
}
