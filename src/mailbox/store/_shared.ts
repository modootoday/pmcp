import { createHash, randomBytes } from "node:crypto";
export const PRESENCE_TTL_MS = 120000;
export const HEARTBEAT_INTERVAL_MS = 30000;
export function hash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
export function secret(): string {
  return randomBytes(32).toString("hex");
}
