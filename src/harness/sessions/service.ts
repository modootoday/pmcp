import { realpathSync } from "node:fs";
import { relative } from "node:path";
import { budgetOperation } from "../adapters/systemd/budget.js";
import { assertOwnedRecords } from "../adapters/tmux/backend.js";
import type { GroupContext } from "../application/context.js";
import type { Receipt, SessionRecord } from "../contracts.js";
import { integer, strings, text } from "../validation.js";
import { assertLaunchAdmission, authorizeSession } from "../launch/service.js";
import { runtimeExecutables } from "../runtimes/registry.js";
import { locateExecutable } from "../adapters/process/executable.js";
import { admitResource } from "../adapters/docker/admission.js";
import { profileName, selectedProfile } from "../runtimes/private-profiles.js";
import { assertProfileAvailable } from "../adapters/docker/private-profile.js";

export async function startSession(
  context: GroupContext,
  input: Record<string, unknown>,
): Promise<Receipt> {
  const { store, backend } = context;
  const group = store.state.group;
  assertOwnedRecords(backend);
  assertLaunchAdmission(backend.recordStore);
  if (
    backend
      .records()
      .some(
        (record) =>
          !record.stoppedAt &&
          !group.sessions.some((session) => session.id === record.id),
      )
  ) {
    throw new Error("unregistered_session_requires_recovery");
  }
  if (group.state !== "ready") throw new Error("group_not_ready");
  const runtime = text(input.runtime, "runtime");
  if (!group.allowedRuntimes.includes(runtime))
    throw new Error("runtime_not_granted");
  const role = input.role;
  if (role !== "main" && role !== "worker") throw new Error("invalid_role");
  if (
    role === "main" &&
    group.sessions.some(
      (session) => session.role === "main" && !session.stopped,
    )
  ) {
    throw new Error("main_already_assigned");
  }
  if (
    role === "worker" &&
    !group.sessions.some(
      (session) => session.role === "main" && !session.stopped,
    )
  ) {
    throw new Error("main_required");
  }
  if (role === "worker") {
    const main = group.sessions.find(
      (session) => session.role === "main" && !session.stopped,
    )!;
    if (!backend.inspect(main.id).alive) throw new Error("main_unavailable");
  }
  const cwd = realpathSync(text(input.cwd ?? group.projectRoot, "cwd"));
  const scope = relative(group.projectRoot, cwd);
  if (scope === ".." || scope.startsWith("../"))
    throw new Error("cwd_outside_project");
  const memoryMb = integer(input.memoryMb ?? 384, "session_memory", 32, 1536);
  const executable = runtimeExecutables[runtime];
  if (!executable) throw new Error("unsupported_runtime");
  const args =
    input.args === undefined ||
    (Array.isArray(input.args) && input.args.length === 0)
      ? []
      : strings(input.args, "runtime_args");
  if (group.profile === "native" && input.containerFile !== undefined)
    throw new Error("container_requires_docker_profile");
  if (group.dockerPolicy?.egress && input.containerFile !== undefined)
    throw new Error("egress_requires_cli_owned_creation");
  const privateProfile =
    input.privateProfile === undefined
      ? undefined
      : profileName(input.privateProfile);
  if (
    privateProfile &&
    (group.profile !== "docker" || input.containerFile !== undefined)
  )
    throw new Error("private_profile_requires_cli_owned_creation");
  if (privateProfile) {
    const profile = selectedProfile(
      group.dockerPolicy!,
      privateProfile,
      runtime,
    )!;
    assertProfileAvailable(profile, group.projectRoot);
  }
  const resource =
    input.containerFile === undefined
      ? undefined
      : admitResource(
          input.containerFile,
          group,
          role,
          backend.runDirectory,
          memoryMb,
          runtime,
        );
  if (resource && args.length)
    throw new Error("container_args_are_fixed_at_creation");
  if (
    resource &&
    backend.records().some((record) => record.resource?.id === resource.id)
  )
    throw new Error("container_already_bound");
  const dockerPreparation =
    group.profile === "docker" && !resource
      ? {
          args,
          memoryMb: integer(memoryMb - 64, "container_memory", 32, 1472),
          cpuQuota: integer(
            input.containerCpuQuota ?? Math.floor(50000 / group.maxActive),
            "container_cpu",
            1,
            50000,
          ),
          ...(privateProfile ? { privateProfile } : {}),
        }
      : undefined;
  const executablePath = locateExecutable(
    resource || dockerPreparation ? "docker" : executable,
    cwd,
  );
  if (!executablePath) throw new Error("runtime_executable_unavailable");
  const argv = resource
    ? [executablePath, "start", "--attach", "--interactive", resource.id]
    : [executablePath, ...args];
  const result = await budgetOperation(backend.runDirectory, {
    action: "start",
    spec: {
      runtime,
      argv,
      cwd,
      memoryMb,
      groupId: group.id,
      generation: group.generation,
      role,
      ...(resource ? { resource } : {}),
      ...(dockerPreparation ? { dockerPreparation } : {}),
    },
  });
  const session = result.session as SessionRecord;
  group.sessions.push({ id: session.id, role, stopped: false });
  store.save();
  authorizeSession(context, session.id);
  return { session, role, generation: group.generation };
}

export async function stopSession(
  context: GroupContext,
  sessionId: string,
): Promise<Receipt> {
  const { store, backend } = context;
  store.session(sessionId);
  assertOwnedRecords(backend);
  const reference = store.state.group.sessions.find(
    (session) => session.id === sessionId,
  )!;
  if (!reference.stopped) {
    await budgetOperation(backend.runDirectory, {
      action: "stop",
      id: sessionId,
    });
    reference.stopped = true;
    store.state.leases = store.state.leases.filter(
      (lease) => lease.sessionId !== sessionId,
    );
    store.save();
  }
  return { sessionId, stopped: true };
}
