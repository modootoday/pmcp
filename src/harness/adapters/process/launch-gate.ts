import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { RecordStore } from "../tmux/records.js";
import { Connection } from "../tmux/connection.js";
import { assertProof, createProof } from "../tmux/launch-identity.js";
import { GroupStore, privateJson } from "../../groups/store.js";
import { LaunchJournal } from "../../launch/journal.js";
import { text } from "../../validation.js";
import { assertResourceFresh } from "../docker/observation.js";
import { createEgressProxy } from "../egress/server.js";
import { assertBridge } from "../docker/bridge-artifact.js";
import { assertPrivateCreation } from "../docker/private-creation.js";

const records = new RecordStore(text(process.argv[2], "directory"));
const journal = new LaunchJournal(records, text(process.argv[3], "session_id"));
const connection = new Connection(records);
const intent = journal.intent();
const proof = createProof(connection, intent);
privateJson(journal.path("proof"), proof);
const deadline = Date.now() + 15_000;
while (!existsSync(journal.path("grant"))) {
  if (existsSync(journal.path("aborted")))
    throw new Error("launch_was_aborted");
  if (Date.now() >= deadline) throw new Error("launch_grant_timeout");
  await setTimeout(25);
}
journal.assertRegistered();
journal.assertGrant();
assertProof(connection, proof);
if (intent.resource) assertResourceFresh(intent.resource);
const creation = intent.dockerCreation;
if (creation) assertBridge(creation);
if (creation)
  assertPrivateCreation(
    creation,
    new GroupStore(join(records.directory, "group.json")).state.group,
    intent.runtime,
  );
const proxy = creation?.egress
  ? await createEgressProxy(
      creation.state,
      `e${intent.nonce.slice(0, 8)}`,
      creation.egress.hosts,
      (events) =>
        privateJson(join(records.directory, `${intent.id}.egress.json`), {
          id: intent.id,
          events,
        }),
    )
  : undefined;
const witness = join(records.directory, `${intent.id}.process.json`);
const startedAt = new Date().toISOString();
privateJson(witness, { id: intent.id, pid: process.pid, startedAt });
const child = spawn(
  text(intent.argv[0], "runtime_executable"),
  intent.argv.slice(1),
  {
    cwd: intent.cwd,
    stdio: "inherit",
    env: process.env,
  },
);
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => {});
child.on("error", async (error: NodeJS.ErrnoException) => {
  await proxy?.close();
  privateJson(witness, {
    id: intent.id,
    startedAt,
    exitedAt: new Date().toISOString(),
    error: error.code,
  });
  process.exitCode = 1;
});
child.on("exit", async (code, signal) => {
  await proxy?.close();
  privateJson(witness, {
    id: intent.id,
    startedAt,
    exitedAt: new Date().toISOString(),
    code,
    signal,
  });
  process.exitCode = code ?? 1;
});
