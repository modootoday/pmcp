import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { artifact } from "./artifact.js";
import type { Operation, Receipt } from "../../contracts.js";
import { GroupStore, privateJson } from "../../groups/store.js";
import { text } from "../../validation.js";

export function serialized(operation: Operation): Receipt {
  const store = new GroupStore(text(operation.groupFile, "group_file"));
  const directory = dirname(store.path);
  const operationFile = join(directory, `operation-${randomUUID()}.json`);
  privateJson(operationFile, operation);
  const worker = artifact("worker");
  try {
    const result = spawnSync(
      "flock",
      [
        "--exclusive",
        "--nonblock",
        "--no-fork",
        "--conflict-exit-code",
        "73",
        join(directory, "group-control.lock"),
        process.execPath,
        worker,
        operationFile,
      ],
      {
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 256 * 1024,
      },
    );
    if (result.status === 73) throw new Error("group_control_busy");
    if (result.error) throw result.error;
    if (!result.stdout.trim()) throw new Error("worker_receipt_missing");
    return JSON.parse(result.stdout) as Receipt;
  } finally {
    if (existsSync(operationFile)) unlinkSync(operationFile);
  }
}
