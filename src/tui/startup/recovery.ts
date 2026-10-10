import { GroupStore } from "../../harness/groups/store.js";
import type { Receipt } from "../../harness/contracts.js";
import { quote } from "../../harness/adapters/process/command.js";
import { startupSettings, type StartupRequest } from "./config.js";
import { readStartup, startupFile } from "./state.js";

function command(args: string[]): string {
  return ["pmcp", ...args].map(quote).join(" ");
}

export function inspectStartupRecovery(request: StartupRequest): Receipt {
  const settings = startupSettings(request);
  const checkpoint = startupFile(settings.projectRoot);
  const state = readStartup(checkpoint, settings.projectRoot);
  const config = settings.configFile ? ["--config", settings.configFile] : [];
  const common = {
    schemaVersion: 1,
    ok: true,
    checkpoint,
    projectRoot: settings.projectRoot,
    providerInvoked: false,
    runtimeRestarted: false,
    inputReplayed: false,
    observedNativeProcesses: false,
  };
  if (!state)
    return {
      ...common,
      status: "not-started",
      hint: "No saved workspace exists. Start explicitly from an interactive terminal.",
      commands: [command(["tui", ...config])],
    };
  if (!state.groupFile || !state.generation)
    return {
      ...common,
      status: "manual-inspection",
      phase: state.phase,
      hint: "Creation stopped before a group reference was saved. Preserve this checkpoint and inspect owned launch evidence before changing it. No group ownership can be inferred from a matching project path.",
      commands: [],
    };
  const store = new GroupStore(state.groupFile);
  const group = store.state.group;
  if (group.projectRoot !== settings.projectRoot)
    throw new Error("startup_project_mismatch");
  if (group.generation !== state.generation)
    throw new Error("stale_group_generation");
  const target = ["--group-file", store.path];
  const generation = ["--generation", group.generation];
  const inspect = command([
    "harness",
    "recovery",
    "inspect",
    ...target,
    "--include-starts",
  ]);
  const status = group.state === "ready" ? state.phase : group.state;
  const commands = [inspect];
  let hint =
    "Inspect actual processes and outstanding starts before any recovery action.";
  if (group.state === "paused") {
    hint =
      "The group is paused. Keep it paused until you explicitly decide to resume it.";
    commands.push(
      command(["harness", "group", "resume", ...target, ...generation]),
    );
  }
  if (group.state === "stopped") {
    hint =
      "The saved group is stopped. An explicitly confirmed fresh launch can create a replacement.";
    commands.push(command(["tui", "--new", ...config]));
  }
  if (
    group.state === "ready" &&
    !["ready", "view-pending"].includes(state.phase)
  ) {
    hint =
      "Startup is incomplete. Inspect pending starts; stop the exact owned group before an explicit fresh launch.";
    commands.push(
      command(["harness", "group", "stop", ...target, ...generation]),
    );
  }
  return {
    ...common,
    status,
    phase: state.phase,
    groupFile: store.path,
    generation: group.generation,
    hint,
    commands,
    commandsRequireExplicitAction: true,
  };
}
