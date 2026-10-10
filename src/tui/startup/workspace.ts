import { existsSync } from "node:fs";
import { invoke } from "../../harness/application/invoke.js";
import { GroupStore } from "../../harness/groups/store.js";
import type {
  Group,
  Receipt,
  SessionObservation,
} from "../../harness/contracts.js";
import { createView } from "../application/create.js";
import { readView } from "../state/store.js";
import { startupSettings, type StartupRequest } from "./config.js";
import {
  readStartup,
  saveStartup,
  startupFile,
  type StartupState,
} from "./state.js";

function succeeded(receipt: Receipt): Receipt {
  if (receipt.ok !== true)
    throw new Error(String(receipt.error ?? "startup_operation_failed"));
  return receipt;
}

export async function prepareWorkspace(
  request: StartupRequest,
): Promise<Receipt> {
  const settings = startupSettings(request);
  const file = startupFile(settings.projectRoot);
  let state = readStartup(file, settings.projectRoot);
  if (state && !["ready", "view-pending"].includes(state.phase)) {
    if (!request.fresh || state.phase === "creating")
      throw new Error("startup_requires_recovery");
  }
  if (state && settings.groupFile && state.groupFile !== settings.groupFile)
    throw new Error("startup_group_conflict");
  if (state) {
    const group = new GroupStore(state.groupFile!).state.group;
    assertGroup(group, settings.projectRoot, state.generation);
    if (group.state === "paused") throw new Error("startup_group_paused");
    if (request.fresh) {
      if (group.state !== "stopped")
        throw new Error("workspace_already_running");
      state = null;
    } else {
      if (group.state !== "ready") throw new Error("startup_requires_recovery");
      if (request.runtime && request.runtime !== state.runtime)
        throw new Error("startup_runtime_conflict");
    }
  }
  if (!state && settings.groupFile) {
    const store = new GroupStore(settings.groupFile);
    const group = store.state.group;
    assertGroup(group, settings.projectRoot);
    if (group.state !== "ready") throw new Error("startup_group_not_ready");
    state = {
      schemaVersion: 1,
      projectRoot: settings.projectRoot,
      phase: "view-pending",
      groupFile: store.path,
      generation: group.generation,
      runtime: settings.runtime,
    };
    saveStartup(file, state);
  }
  if (!state) {
    state = {
      schemaVersion: 1,
      projectRoot: settings.projectRoot,
      phase: "creating",
      runtime: settings.runtime,
    };
    saveStartup(file, state);
    const created = succeeded(
      await invoke({
        family: "group",
        action: "create",
        input: {
          projectRoot: settings.projectRoot,
          allowedRuntimes: [...settings.allowedRuntimes],
          memoryMb: settings.memoryMb,
          maxActive: settings.maxActive,
        },
      }),
    );
    state.groupFile = String(created.groupFile);
    state.generation = (created.group as Group).generation;
    state.phase = "starting";
    saveStartup(file, state);
    succeeded(
      await invoke({
        family: "session",
        action: "start",
        groupFile: state.groupFile,
        generation: state.generation,
        input: {
          runtime: settings.runtime,
          role: "main",
          memoryMb: settings.sessionMemoryMb,
        },
      }),
    );
    state.phase = "view-pending";
    saveStartup(file, state);
  }
  const observed = succeeded(
    await invoke({
      family: "session",
      action: "list",
      groupFile: state.groupFile,
    }),
  );
  const sessions = observed.sessions as (SessionObservation & {
    role: string;
  })[];
  const main = sessions.find(
    (session) => session.role === "main" && session.alive,
  );
  if (!main) throw new Error("startup_main_unavailable");
  state.runtime = main.runtime;
  const existing =
    state.viewFile && existsSync(state.viewFile)
      ? readView(state.viewFile).view
      : undefined;
  if (existing) {
    if (
      existing.groupFile !== state.groupFile ||
      existing.generation !== state.generation
    )
      throw new Error("foreign_startup_view");
  }
  if (!existing || existing.state === "closed") {
    const created = await createView({
      groupFile: state.groupFile!,
      columns: process.stdout.columns ?? Number(process.env.PMCP_TUI_COLUMNS),
      rows: process.stdout.rows ?? Number(process.env.PMCP_TUI_ROWS),
    });
    state.viewFile = created.viewFile;
  }
  state.phase = "ready";
  saveStartup(file, state);
  return {
    schemaVersion: 1,
    ok: true,
    viewFile: state.viewFile,
    groupFile: state.groupFile,
    generation: state.generation,
    runtime: state.runtime,
    readOnly: true,
  };
}

function assertGroup(
  group: Group,
  projectRoot: string,
  generation?: string,
): void {
  if (group.projectRoot !== projectRoot)
    throw new Error("startup_project_mismatch");
  if (generation && group.generation !== generation)
    throw new Error("stale_group_generation");
}
