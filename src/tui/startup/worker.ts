import { invoke } from "../../harness/application/invoke.js";
import { GroupStore } from "../../harness/groups/store.js";
import { runtimeExecutables } from "../../harness/runtimes/registry.js";
import { locateExecutable } from "../../harness/adapters/process/executable.js";
import type { Receipt } from "../../harness/contracts.js";
import { startupSettings, type StartupRequest } from "./config.js";
import { readStartup, startupFile } from "./state.js";

export async function startWorkspaceWorker(
  request: StartupRequest,
  runtime: string,
  memoryMb?: number,
): Promise<Receipt> {
  if (!Object.hasOwn(runtimeExecutables, runtime))
    throw new Error("unsupported_runtime");
  const settings = startupSettings({
    cwd: request.cwd,
    config: request.config,
  });
  const state = readStartup(
    startupFile(settings.projectRoot),
    settings.projectRoot,
  );
  if (
    !state ||
    state.phase !== "ready" ||
    !state.groupFile ||
    !state.generation
  )
    throw new Error("startup_requires_recovery");
  const store = new GroupStore(state.groupFile);
  const group = store.state.group;
  if (group.projectRoot !== settings.projectRoot)
    throw new Error("startup_project_mismatch");
  if (group.generation !== state.generation)
    throw new Error("stale_group_generation");
  if (group.state === "paused") throw new Error("startup_group_paused");
  if (group.state !== "ready") throw new Error("startup_group_not_ready");
  if (
    group.profile === "native" &&
    !locateExecutable(runtimeExecutables[runtime]!, request.cwd)
  )
    throw new Error("runtime_executable_unavailable");
  const observed = await invoke({
    family: "session",
    action: "list",
    groupFile: store.path,
  });
  if (observed.ok !== true) return observed;
  const sessions = observed.sessions as { role: string; alive?: boolean }[];
  if (!sessions.some((session) => session.role === "main" && session.alive))
    throw new Error("startup_main_unavailable");
  return invoke({
    family: "session",
    action: "start",
    groupFile: store.path,
    generation: group.generation,
    input: {
      runtime,
      role: "worker",
      memoryMb: memoryMb ?? settings.sessionMemoryMb,
    },
  });
}
