import { createInterface } from "node:readline/promises";
import { locateExecutable } from "../../harness/adapters/process/executable.js";
import { runtimeExecutables } from "../../harness/runtimes/registry.js";
import { invokeTui } from "../application/invoke.js";
import { startupSettings, type StartupRequest } from "./config.js";
import { readStartup, startupFile } from "./state.js";
import { requireTerminal } from "./host.js";
import { serializedStartup } from "./lock.js";
import type { Receipt } from "../../harness/contracts.js";

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
  const settings = startupSettings(request);
  const state = readStartup(
    startupFile(settings.projectRoot),
    settings.projectRoot,
  );
  const starting = (!state || request.fresh) && !settings.groupFile;
  if (starting) {
    if (!locateExecutable(runtimeExecutables[settings.runtime]!, request.cwd))
      throw new Error("runtime_executable_unavailable");
    process.stderr.write(
      `PMCP main: ${settings.runtime} | ${settings.projectRoot}\n`,
    );
    if (!confirmed && !(await confirmStart(settings.runtime)))
      return {
        schemaVersion: 1,
        ok: true,
        cancelled: true,
        providerInvoked: false,
      };
  }
  const prepared = serializedStartup(request);
  if (prepared.ok !== true) return prepared;
  return invokeTui({
    action: "open",
    viewFile: String(prepared.viewFile),
    input: {},
  });
}

async function confirmStart(runtime: string): Promise<boolean> {
  const prompt = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const answer = await prompt.question(
      `Start ${runtime}? [Enter=start, q=cancel] `,
    );
    return answer.trim() === "";
  } finally {
    prompt.close();
  }
}
