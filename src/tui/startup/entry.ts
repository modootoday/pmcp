import { locateExecutable } from "../../harness/adapters/process/executable.js";
import { runtimeExecutables } from "../../harness/runtimes/registry.js";
import { invokeTui } from "../application/invoke.js";
import { startupSettings, type StartupRequest } from "./config.js";
import { readStartup, startupFile } from "./state.js";
import { requireTerminal } from "./host.js";
import { serializedStartup } from "./lock.js";
import type { Receipt } from "../../harness/contracts.js";
import {
  chooseRuntime,
  confirmRuntimeStart,
  terminalPrompt,
} from "../presentation/runtime-choice.js";

export function planStartup(request: StartupRequest): Receipt {
  const settings = startupSettings(request);
  const state = readStartup(
    startupFile(settings.projectRoot),
    settings.projectRoot,
  );
  return {
    schemaVersion: 1,
    ok: true,
    settings,
    savedWorkspace: state,
    willStartRuntime: !state && !settings.groupFile,
    runtimeExecutable: locateExecutable(
      runtimeExecutables[settings.runtime]!,
      request.cwd,
    ),
    providerInvoked: false,
  };
}

export async function launchStartup(
  request: StartupRequest,
  confirmed: boolean,
): Promise<Receipt> {
  requireTerminal();
  let settings = startupSettings(request);
  const state = readStartup(
    startupFile(settings.projectRoot),
    settings.projectRoot,
  );
  const starting = (!state || request.fresh) && !settings.groupFile;
  if (starting) {
    if (!confirmed) {
      const prompt = terminalPrompt();
      try {
        let runtime = settings.runtime;
        process.stderr.write(`PMCP MAIN | ${settings.projectRoot}\n`);
        if (!request.runtime) {
          const installed = settings.allowedRuntimes.filter((id) =>
            locateExecutable(runtimeExecutables[id]!, request.cwd),
          );
          const selected = await chooseRuntime(prompt, installed, runtime);
          if (!selected) return cancelledStart();
          runtime = selected;
        }
        if (!(await confirmRuntimeStart(prompt, runtime)))
          return cancelledStart();
        request = { ...request, runtime };
        settings = startupSettings(request);
      } finally {
        prompt.close();
      }
    }
    if (!locateExecutable(runtimeExecutables[settings.runtime]!, request.cwd))
      throw new Error("runtime_executable_unavailable");
    process.stderr.write(
      `PMCP main: ${settings.runtime} | ${settings.projectRoot}\n`,
    );
  }
  const prepared = serializedStartup(request);
  if (prepared.ok !== true) return prepared;
  return invokeTui({
    action: "open",
    viewFile: String(prepared.viewFile),
    input: {},
  });
}

function cancelledStart(): Receipt {
  return {
    schemaVersion: 1,
    ok: true,
    cancelled: true,
    providerInvoked: false,
  };
}
