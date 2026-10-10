import { unlinkSync } from "node:fs";
import type { Operation } from "../contracts.js";
import { GroupStore, readPrivateJson } from "../groups/store.js";
import { text } from "../validation.js";
import { runOperation } from "./dispatch.js";

const operationFile = process.argv[2]!;
try {
  const operation = readPrivateJson(operationFile) as Operation;
  const receipt = await runOperation(operation);
  const group = new GroupStore(text(operation.groupFile, "group_file")).state
    .group;
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      ok: true,
      groupId: group.id,
      generation: group.generation,
      effect: `${operation.family}:${operation.action}`,
      ...receipt,
    }),
  );
  if (receipt.ok === false) process.exitCode = 1;
} catch (error) {
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      ok: false,
      error: error instanceof Error ? error.message : "operation_failed",
      resendAllowed: false,
    }),
  );
  process.exitCode = 1;
} finally {
  unlinkSync(operationFile);
}
