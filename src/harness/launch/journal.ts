import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { RecordStore } from "../adapters/tmux/records.js";
import { budgetSlice, runtimeUnit } from "../adapters/tmux/records.js";
import { GroupStore, privateJson, readPrivateJson } from "../groups/store.js";
import { integer, object, strings, text } from "../validation.js";
import { resourceClaim } from "../adapters/docker/claims.js";
import { egressPolicy } from "../runtimes/egress-policy.js";
import { selectedProfile } from "../runtimes/private-profiles.js";
import { containerLabels, containerName } from "../adapters/docker/identity.js";
import type {
  AbortRecord,
  LaunchGrant,
  LaunchIntent,
  LaunchProof,
} from "./contracts.js";

export class LaunchJournal {
  constructor(
    readonly records: RecordStore,
    readonly id: string,
  ) {
    runtimeUnit(id);
  }

  path(kind: string): string {
    if (!["intent", "proof", "grant", "committed", "aborted"].includes(kind))
      throw new Error("invalid_launch_artifact");
    return join(this.records.directory, `${this.id}.${kind}.json`);
  }

  intent(): LaunchIntent {
    const value = object(readPrivateJson(this.path("intent")));
    if (
      value.id !== this.id ||
      value.owner !== this.records.owner ||
      value.socket !== this.records.socket ||
      value.unit !== runtimeUnit(this.id) ||
      value.slice !== budgetSlice(this.records.owner)
    )
      throw new Error("foreign_launch_intent");
    if (!/^\d+:\d+$/.test(text(value.controllerIdentity, "controller")))
      throw new Error("invalid_launch_controller");
    for (const field of ["groupId", "generation", "nonce"])
      runtimeUnit(text(value[field], field));
    if (value.role !== "main" && value.role !== "worker")
      throw new Error("invalid_launch_role");
    strings(value.argv, "argv");
    text(value.cwd, "cwd");
    text(value.runtime, "runtime");
    text(value.createdAt, "created_at");
    integer(value.memoryMb, "session_memory", 32, 1536);
    if (value.resource !== undefined)
      resourceClaim(value.resource, this.records.owner);
    if (value.dockerCreation !== undefined) {
      const creation = object(value.dockerCreation);
      const config = object(creation.configuration);
      const labels = object(config.Labels);
      if (creation.egress !== undefined) egressPolicy(creation.egress);
      const bridge =
        creation.egress === undefined
          ? undefined
          : egressPolicy(creation.egress).bridgeExecutable;
      if (bridge && !/^[a-f0-9]{64}$/.test(String(creation.bridgeSha256)))
        throw new Error("invalid_docker_bridge_digest");
      if (!bridge && creation.bridgeSha256 !== undefined)
        throw new Error("ungranted_docker_bridge_digest");
      const policy = new GroupStore(join(this.records.directory, "group.json"))
        .state.group.dockerPolicy;
      const profile = selectedProfile(
        policy!,
        creation.privateProfile,
        text(value.runtime, "runtime"),
      );
      const expectedState =
        profile?.directory ??
        join(
          this.records.directory,
          "containers",
          text(value.nonce, "nonce"),
          "profile",
        );
      if (
        value.resource !== undefined &&
        object(value.resource).privateProfile !== creation.privateProfile
      )
        throw new Error("launch_private_profile_mismatch");
      if (
        creation.name !== containerName(this.records.owner, this.id) ||
        creation.nonce !== value.nonce ||
        creation.state !== expectedState ||
        labels[containerLabels.owner] !== this.records.owner ||
        labels[containerLabels.role] !== value.role ||
        labels[containerLabels.nonce] !== value.nonce
      )
        throw new Error("foreign_container_creation");
    }
    return value as unknown as LaunchIntent;
  }

  proof(): LaunchProof {
    const intent = this.intent();
    const value = object(readPrivateJson(this.path("proof")));
    const session = object(value.session);
    if (
      value.nonce !== intent.nonce ||
      session.id !== intent.id ||
      session.owner !== intent.owner ||
      session.socket !== intent.socket ||
      session.unit !== intent.unit ||
      session.cwd !== intent.cwd ||
      session.memoryMb !== intent.memoryMb ||
      session.runtime !== intent.runtime ||
      session.createdAt !== intent.createdAt ||
      JSON.stringify(session.resource) !== JSON.stringify(intent.resource)
    )
      throw new Error("foreign_launch_proof");
    for (const [field, pattern] of [
      ["paneId", /^%\d+$/],
      ["windowId", /^@\d+$/],
      ["tmuxSessionId", /^\$\d+$/],
      ["serverIdentity", /^\d+:\d+$/],
    ] as const) {
      if (!pattern.test(text(session[field], field)))
        throw new Error("invalid_launch_identity");
    }
    integer(session.panePid, "pane_process", 1, Number.MAX_SAFE_INTEGER);
    if (!/^\d+:\d+$/.test(text(value.runnerIdentity, "runner")))
      throw new Error("invalid_launch_runner");
    return value as unknown as LaunchProof;
  }

  grant(): LaunchGrant {
    const intent = this.intent();
    return {
      id: intent.id,
      owner: intent.owner,
      groupId: intent.groupId,
      generation: intent.generation,
      nonce: intent.nonce,
      proofDigest: createHash("sha256")
        .update(JSON.stringify(this.proof()))
        .digest("hex"),
    };
  }

  assertRegistered(): void {
    const intent = this.intent();
    const group = new GroupStore(join(this.records.directory, "group.json"))
      .state.group;
    if (group.id !== intent.groupId || group.generation !== intent.generation)
      throw new Error("launch_group_generation_mismatch");
    if (
      intent.dockerCreation &&
      JSON.stringify(intent.dockerCreation.egress) !==
        JSON.stringify(group.dockerPolicy?.egress)
    )
      throw new Error("launch_egress_grant_mismatch");
    if (
      group.state !== "ready" ||
      !group.allowedRuntimes.includes(intent.runtime)
    )
      throw new Error("launch_group_not_ready");
    if (
      !group.sessions.some(
        (session) =>
          session.id === intent.id &&
          session.role === intent.role &&
          !session.stopped,
      )
    )
      throw new Error("launch_registration_missing");
    const record = this.records.read(this.id);
    if (JSON.stringify(record) !== JSON.stringify(this.proof().session))
      throw new Error("launch_record_mismatch");
  }

  authorize(): void {
    if (existsSync(this.path("aborted"))) throw new Error("launch_was_aborted");
    this.assertRegistered();
    privateJson(this.path("grant"), this.grant());
  }

  assertGrant(): void {
    if (existsSync(this.path("aborted"))) throw new Error("launch_was_aborted");
    const grant = object(readPrivateJson(this.path("grant")));
    if (JSON.stringify(grant) !== JSON.stringify(this.grant()))
      throw new Error("launch_grant_mismatch");
  }

  commit(): void {
    this.assertRegistered();
    this.assertGrant();
    privateJson(this.path("committed"), this.grant());
  }

  assertCommitted(): void {
    this.assertGrant();
    const committed = object(readPrivateJson(this.path("committed")));
    if (JSON.stringify(committed) !== JSON.stringify(this.grant()))
      throw new Error("launch_commit_mismatch");
  }

  abortRecord(): AbortRecord | undefined {
    if (!existsSync(this.path("aborted"))) return;
    const value = object(readPrivateJson(this.path("aborted")));
    if (
      value.id !== this.id ||
      value.owner !== this.records.owner ||
      !["stopping", "stopped"].includes(String(value.state))
    )
      throw new Error("foreign_launch_abort");
    return value as unknown as AbortRecord;
  }
}

export function launchJournals(records: RecordStore): LaunchJournal[] {
  return readdirSync(records.directory)
    .filter((name) => name.endsWith(".intent.json"))
    .map((name) => new LaunchJournal(records, name.slice(0, -12)));
}

export function pendingLaunches(records: RecordStore): LaunchJournal[] {
  return launchJournals(records).filter((journal) => {
    const aborted = journal.abortRecord();
    if (aborted) return aborted.state !== "stopped";
    if (!existsSync(journal.path("committed"))) return true;
    journal.assertCommitted();
    return false;
  });
}
