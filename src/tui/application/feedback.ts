import type { ControlPhase, View, ViewFailure } from "../contracts.js";
import { readView, saveView } from "../state/store.js";
import { privateJson } from "../../harness/groups/store.js";
import { join } from "node:path";

const hints: Readonly<Record<string, string>> = {
  startup_requires_recovery:
    "Run pmcp tui recovery for saved ownership and exact inspection commands. No runtime was restarted.",
  startup_group_paused:
    "The saved group is paused. Resume it explicitly through the harness CLI before reopening.",
  startup_main_unavailable:
    "Inspect the saved main and recovery state. Stop the old group explicitly before using pmcp tui --new.",
  startup_busy: "Another workspace launch is running. Wait and retry.",
  startup_runtime_conflict:
    "The saved main uses another runtime. Stop the old group before creating a new workspace.",
  workspace_already_running:
    "Reopen the existing workspace, or stop its exact owned group before using --new.",
  runtime_executable_unavailable:
    "Install the selected native CLI on PATH, or choose an installed runtime with --runtime.",
  control_connection_lost:
    "The native writer or lease disappeared. Inspect and release control before reconnecting.",
  control_busy:
    "Another controller holds the lease. Release it explicitly before retrying.",
  native_writer_active:
    "A native writer is still attached. Detach that writer before retrying.",
  group_control_busy:
    "Another group operation is running. Inspect before retrying.",
  stale_group_generation:
    "The group generation changed. Close this view and create a fresh view.",
  worker_index_unavailable: "Select a worker index shown in the dock.",
  worker_unavailable: "Inspect the worker with pmcp harness session inspect.",
  writer_not_ready:
    "The writer did not become ready. Inspect control and attachment state before retrying.",
  view_already_controls_target:
    "Release the current target before requesting control again.",
  mailbox_not_configured:
    "Create a view with --config and --actor-file to observe inbox metadata.",
  confirm_exact_stop_target:
    "Supply --confirm-session with the exact target ID.",
  target_not_native:
    "Return to the native main or worker before requesting control.",
  terminal_size_invalid:
    "Use integer dimensions: 40–1000 columns and 12–1000 rows.",
  terminal_required: "Open the view from an interactive terminal.",
  tui_dependencies_unavailable:
    "Run pmcp tui doctor and install the missing host dependencies.",
  tui_build_required:
    "Install a complete PMCP distribution with its tui-worker.js artifact.",
};

export function describeFailure(action: string, error: unknown): ViewFailure {
  const message = error instanceof Error ? error.message : "view_action_failed";
  const code =
    error instanceof RangeError
      ? "terminal_size_invalid"
      : failureCode(message);
  return {
    action,
    code,
    hint: hints[code] ?? "Inspect the view and group. No input was replayed.",
    at: new Date().toISOString(),
    inputReplayed: false,
  };
}

function failureCode(message: string): string {
  return /^[a-z][a-z0-9_]{0,79}$/.test(message)
    ? message
    : "view_action_failed";
}

export function setPhase(file: string, view: View, phase: ControlPhase): void {
  view.phase = phase;
  saveView(file, view);
}

export function recordCallbackFailure(
  file: string,
  action: string,
  error: unknown,
): void {
  const { view } = readView(file);
  if (view.state === "closed") return;
  privateJson(join(view.directory, "callback-failure.json"), {
    owner: view.owner,
    failure: describeFailure(action, error),
  });
}

export function phaseLabel(phase: ControlPhase): string {
  const labels: Record<ControlPhase, string> = {
    "read-only": "READ ONLY",
    acquiring: "REQUESTING CONTROL",
    connecting: "CONNECTING WRITER",
    controlled: "CONTROL READY",
    releasing: "RELEASING CONTROL",
    uncertain: "CONTROL UNKNOWN / INPUT BLOCKED",
  };
  return labels[phase];
}
