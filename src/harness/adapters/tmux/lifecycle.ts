import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { artifact } from "../process/artifact.js";
import type { DockerResource, SessionRecord } from "../../contracts.js";
import { GroupStore, privateJson } from "../../groups/store.js";
import { join } from "node:path";
import { integer, text } from "../../validation.js";
import { quote } from "../process/command.js";
import { processIdentity } from "../process/identity.js";
import { stopUnit } from "../systemd/units.js";
import type { Connection } from "./connection.js";
import { assertProof } from "./launch-identity.js";
import { budgetSlice, runtimeUnit } from "./records.js";
import { LaunchJournal, pendingLaunches } from "../../launch/journal.js";
import { abortLaunch } from "../../launch/recovery.js";
import { stopResource } from "../docker/lifecycle.js";
import {
  creationPlan,
  type DockerPreparation,
} from "../docker/creation-plan.js";
import { prepareCreation } from "../docker/creation.js";

export interface LaunchSpec {
  runtime: string;
  argv: string[];
  cwd: string;
  memoryMb: number;
  budgetSlice?: string;
  groupId: string;
  generation: string;
  role: "main" | "worker";
  resource?: DockerResource;
  dockerPreparation?: DockerPreparation;
}

export async function start(
  connection: Connection,
  spec: LaunchSpec,
): Promise<SessionRecord> {
  const records = connection.records;
  if (spec.budgetSlice !== budgetSlice(records.owner))
    throw new Error("foreign_budget_slice");
  integer(spec.memoryMb, "session_memory", 32, 1536);
  runtimeUnit(spec.groupId);
  runtimeUnit(spec.generation);
  if (spec.role !== "main" && spec.role !== "worker")
    throw new Error("invalid_launch_role");
  const id = randomUUID();
  const nonce = randomUUID();
  const journal = new LaunchJournal(records, id);
  const dockerCreation = spec.dockerPreparation
    ? creationPlan(
        new GroupStore(join(records.directory, "group.json")).state.group,
        records.directory,
        id,
        nonce,
        spec.role,
        spec.runtime,
        spec.cwd,
        spec.dockerPreparation,
      )
    : undefined;
  privateJson(journal.path("intent"), {
    id,
    owner: records.owner,
    controllerIdentity: processIdentity(process.pid),
    groupId: spec.groupId,
    generation: spec.generation,
    role: spec.role,
    nonce,
    unit: runtimeUnit(id),
    slice: spec.budgetSlice,
    socket: records.socket,
    runtime: spec.runtime,
    memoryMb: spec.memoryMb,
    argv: spec.argv,
    cwd: spec.cwd,
    createdAt: new Date().toISOString(),
    ...(spec.resource ? { resource: spec.resource } : {}),
    ...(dockerCreation ? { dockerCreation } : {}),
  });
  if (dockerCreation) await prepareCreation(journal);
  const intent = journal.intent();
  const argv = [
    "systemd-run",
    "--user",
    "--scope",
    "--collect",
    "--quiet",
    `--unit=${intent.unit}`,
    `--slice=${intent.slice}`,
    `--property=MemoryMax=${spec.memoryMb - (intent.resource?.memoryMb ?? 0)}M`,
    "--property=TasksMax=128",
    "--property=CPUQuota=100%",
    process.execPath,
    artifact("launch-gate"),
    records.directory,
    id,
  ];
  connection.tmux([
    "new-session",
    "-d",
    "-x",
    "160",
    "-y",
    "42",
    "-s",
    `pmcp-${id}`,
    "-c",
    spec.cwd,
    `exec ${argv.map(quote).join(" ")}`,
  ]);
  const deadline = Date.now() + 5000;
  while (!existsSync(journal.path("proof"))) {
    if (Date.now() >= deadline) throw new Error("launch_proof_timeout");
    await setTimeout(25);
  }
  const proof = journal.proof();
  assertProof(connection, proof);
  records.save(proof.session);
  return proof.session;
}

export function stop(connection: Connection, id: string): void {
  const journal = new LaunchJournal(connection.records, id);
  if (existsSync(journal.path("intent"))) {
    abortLaunch(connection, journal);
    return;
  }
  const record = connection.inspect(id);
  if (record.resource) stopResource(record.resource);
  stopUnit(record.unit);
  connection.inspect(id);
  connection.tmux(["kill-pane", "-t", record.paneId]);
  connection.records.save({ ...record, stoppedAt: new Date().toISOString() });
}

export function cleanup(connection: Connection): void {
  for (const journal of pendingLaunches(connection.records))
    abortLaunch(connection, journal);
  const records = connection.records.all();
  if (connection.alive()) {
    const panes = connection
      .tmux(["list-panes", "-a", "-F", "#{@pmcp-owner}|#{@pmcp-session}"])
      .trim()
      .split("\n");
    if (
      panes.some(
        (pane) =>
          !records.some((record) => pane === `${record.owner}|${record.id}`),
      )
    )
      throw new Error("cleanup_foreign_pane");
    for (const record of records) {
      if (!record.stoppedAt) connection.inspect(record.id);
    }
  }
  for (const record of records) {
    if (record.resource) stopResource(record.resource);
    if (
      record.stoppedAt ||
      !existsSync(
        new LaunchJournal(connection.records, record.id).path("intent"),
      )
    ) {
      stopUnit(record.unit);
      continue;
    }
    stop(connection, record.id);
  }
  if (connection.alive()) connection.tmux(["kill-server"]);
}
