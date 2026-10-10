import { setTimeout } from "node:timers/promises";
import { serialized } from "../adapters/process/serialized.js";
import type { Operation, Receipt } from "../contracts.js";

export async function releaseAttachmentControl(
  operation: Operation,
): Promise<Receipt> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return serialized({ ...operation, family: "control", action: "release" });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "group_control_busy" ||
        attempt === 9
      )
        throw error;
    }
    await setTimeout(50);
  }
  throw new Error("control_release_unconfirmed");
}
