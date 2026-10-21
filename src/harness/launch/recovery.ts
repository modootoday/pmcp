import { existsSync } from "node:fs";
import type { Connection } from "../adapters/terminal/connection.js";
import {
  assertProof,
  panePresent,
} from "../adapters/terminal/launch-identity.js";
import { controllerExited } from "../adapters/process/identity.js";
import { stopUnit, unitActive } from "../adapters/systemd/units.js";
import { privateJson } from "../groups/store.js";
import { LaunchJournal } from "./journal.js";
import type { Receipt } from "../contracts.js";
import { stopResource } from "../adapters/docker/lifecycle.js";
import { findCreation } from "../adapters/docker/creation.js";

export function abortLaunch(
  connection: Connection,
  journal: LaunchJournal,
): Receipt {
  const intent = journal.intent();
  if (!controllerExited(intent.controllerIdentity))
    throw new Error("launch_controller_alive");
  const previous = journal.abortRecord();
  const resource = intent.dockerCreation
    ? findCreation(journal)
    : intent.resource;
  if (previous?.state === "stopped") {
    if (resource) stopResource(resource);
    if (unitActive(intent.unit)) throw new Error("runtime_stop_unconfirmed");
    return {
      stopped: true,
      alreadyStopped: true,
      adopted: false,
      inputReplayed: false,
    };
  }
  if (!existsSync(journal.path("proof"))) {
    const named = () =>
      (
        (connection.must({ op: "list" })["sessions"] ?? []) as Record<
          string,
          unknown
        >[]
      ).some((s) => s["name"] === `pmcp-${intent.id}`);
    const paneUnknown =
      connection.alive() && (!intent.dockerCreation || named());
    if (paneUnknown || unitActive(intent.unit))
      throw new Error("launch_identity_unknown");
    if (resource) stopResource(resource);
    privateJson(journal.path("aborted"), {
      id: intent.id,
      owner: intent.owner,
      state: "stopped",
      noRuntimeBorn: true,
    });
    return { stopped: true, adopted: false, inputReplayed: false };
  }
  const proof = journal.proof();
  const present = panePresent(connection, proof);
  if (present) assertProof(connection, proof);
  if (resource) stopResource(resource);
  privateJson(journal.path("aborted"), {
    id: intent.id,
    owner: intent.owner,
    state: "stopping",
  });
  stopUnit(intent.unit);
  if (present) {
    assertProof(connection, proof);
    connection.must({
      op: "kill",
      id: proof.session.ptySession,
      expect: connection.expect(proof.session),
    });
  }
  if (existsSync(journal.records.path(intent.id)))
    journal.records.save({
      ...proof.session,
      stoppedAt: new Date().toISOString(),
    });
  privateJson(journal.path("aborted"), {
    id: intent.id,
    owner: intent.owner,
    state: "stopped",
  });
  return { stopped: true, adopted: false, inputReplayed: false };
}
