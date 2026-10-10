import { existsSync, lstatSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Backend } from "../tmux/backend.js";
import { readPrivateJson } from "../../groups/store.js";
import { object, text } from "../../validation.js";
import { controllerExited } from "./identity.js";

export function recoverInputLock(backend: Backend, sessionId: string): void {
  backend.inspect(sessionId);
  const path = join(backend.runDirectory, `${sessionId}.input.lock`);
  if (!existsSync(path)) return;
  const before = lstatSync(path);
  const record = object(readPrivateJson(path));
  if (record.id !== sessionId) throw new Error("foreign_writer_lock");
  if (!controllerExited(text(record.controller, "controller_identity")))
    throw new Error("writer_still_alive");
  if (lstatSync(path).ino !== before.ino)
    throw new Error("writer_lock_changed");
  unlinkSync(path);
}
