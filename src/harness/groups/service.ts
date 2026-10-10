import { randomUUID } from "node:crypto";
import { realpathSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { assertOwnedRecords, createBackend } from "../adapters/tmux/backend.js";
import { budgetOperation } from "../adapters/systemd/budget.js";
import { configureBudget } from "../adapters/systemd/configure.js";
import type { GroupContext } from "../application/context.js";
import type { Group, Receipt } from "../contracts.js";
import { integer, strings, text } from "../validation.js";
import { privateJson } from "./store.js";
import { runtimeExecutables } from "../runtimes/registry.js";
import { assertNativeHost } from "../adapters/systemd/admission.js";
import { loadDockerPolicy } from "../adapters/docker/profile.js";

export async function createGroup(
  input: Record<string, unknown>,
): Promise<{ groupFile: string; group: Group }> {
  const projectRoot = realpathSync(text(input.projectRoot, "project_root"));
  if (!statSync(projectRoot).isDirectory())
    throw new Error("invalid_project_root");
  const allowedRuntimes = strings(input.allowedRuntimes, "allowed_runtimes");
  const profile = input.profile ?? "native";
  if (profile !== "native" && profile !== "docker")
    throw new Error("invalid_profile");
  if (profile === "native" && input.dockerPolicyFile !== undefined)
    throw new Error("docker_policy_requires_docker_profile");
  const supported = Object.keys(runtimeExecutables);
  if (allowedRuntimes.some((runtime) => !supported.includes(runtime)))
    throw new Error("unsupported_runtime");
  const memoryMb = integer(input.memoryMb ?? 2048, "memory_budget", 128, 4096);
  const maxActive = integer(input.maxActive ?? 1, "max_active", 1, 5);
  const dockerPolicy =
    profile === "docker"
      ? loadDockerPolicy(input.dockerPolicyFile, projectRoot, allowedRuntimes)
      : undefined;
  assertNativeHost();
  const backend = createBackend();
  const group: Group = {
    schemaVersion: 1,
    owner: backend.owner,
    id: randomUUID(),
    generation: randomUUID(),
    projectRoot,
    allowedRuntimes,
    profile,
    state: "ready",
    memoryMb,
    maxActive,
    sessions: [],
    ...(dockerPolicy ? { dockerPolicy } : {}),
  };
  const groupFile = join(backend.runDirectory, "group.json");
  privateJson(groupFile, { group, leases: [], deliveries: [] });
  try {
    await budgetOperation(backend.runDirectory, {
      action: "configure",
      memoryMb,
      maxActive,
    });
  } catch (error) {
    try {
      await budgetOperation(backend.runDirectory, { action: "cleanup" });
      unlinkSync(groupFile);
    } catch (cleanupError) {
      privateJson(join(backend.runDirectory, "initialization-failure.json"), {
        error: String(error),
        cleanupError: String(cleanupError),
        recoveryRequired: true,
      });
    }
    throw error;
  }
  return { groupFile, group };
}

export async function groupOperation(
  context: GroupContext,
  action: string,
  input: Record<string, unknown> = {},
): Promise<Receipt> {
  const { store, backend } = context;
  if (action === "inspect") return { group: store.state.group };
  if (action === "configure") {
    if (store.state.group.state === "stopped") throw new Error("group_stopped");
    if (input.profile !== undefined || input.dockerPolicyFile !== undefined)
      throw new Error("profile_change_requires_new_group");
    const allowedRuntimes =
      input.allowedRuntimes === undefined
        ? store.state.group.allowedRuntimes
        : strings(input.allowedRuntimes, "allowed_runtimes");
    if (
      allowedRuntimes.some(
        (runtime) => !store.state.group.allowedRuntimes.includes(runtime),
      )
    )
      throw new Error("runtime_grant_expansion_requires_new_group");
    Object.assign(store.state.group, configureBudget(context, input), {
      allowedRuntimes,
    });
    store.save();
    return { group: store.state.group, nativePermissionsChanged: false };
  }
  if (action === "pause" || action === "resume") {
    if (store.state.group.state === "stopped") throw new Error("group_stopped");
    store.state.group.state = action === "pause" ? "paused" : "ready";
    store.save();
    return { group: store.state.group, runtimesInterrupted: false };
  }
  if (action !== "stop") throw new Error("unsupported_group_operation");
  if (store.state.group.state !== "stopped") {
    assertOwnedRecords(backend);
    await budgetOperation(backend.runDirectory, { action: "cleanup" });
    store.state.group.state = "stopped";
    store.state.leases = [];
    store.state.group.sessions.forEach((session) => {
      session.stopped = true;
    });
    store.save();
  }
  return { group: store.state.group, inputReplayed: false };
}
