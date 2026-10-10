import { locateExecutable } from "../../harness/adapters/process/executable.js";
import { runtimeExecutables } from "../../harness/runtimes/registry.js";
import { openView } from "../application/context.js";
import { startViewWorker } from "../application/worker-start.js";
import { requireTerminal } from "../startup/host.js";
import {
  chooseRuntime,
  confirmRuntimeStart,
  terminalPrompt,
} from "./runtime-choice.js";

export async function runWorkerMenu(file: string): Promise<void> {
  requireTerminal();
  const { view, common } = openView(file);
  if (view.state !== "open") throw new Error("view_closed");
  const observed = await common.snapshot();
  const group = observed.group;
  if (group.state !== "ready") throw new Error("startup_group_not_ready");
  const choices = group.allowedRuntimes.filter((runtime) => {
    const executable = runtimeExecutables[runtime];
    if (!executable) return false;
    if (group.profile === "docker")
      return Boolean(group.dockerPolicy?.commands[runtime]);
    return Boolean(locateExecutable(executable, group.projectRoot));
  });
  const main = observed.sessions.find((session) => session.id === view.mainId);
  if (!main?.alive) throw new Error("startup_main_unavailable");
  process.stderr.write(`PMCP WORKER | ${group.projectRoot}\n`);
  const prompt = terminalPrompt();
  try {
    const runtime = await chooseRuntime(prompt, choices, main.runtime);
    if (!runtime || !(await confirmRuntimeStart(prompt, runtime))) return;
    await startViewWorker(file, runtime);
  } finally {
    prompt.close();
  }
}
