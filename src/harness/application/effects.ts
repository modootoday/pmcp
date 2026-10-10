import type { Operation } from "../contracts.js";

const observations = new Set([
  "group:inspect",
  "session:list",
  "session:inspect",
  "session:read",
  "session:watch",
  "delivery:list",
  "delivery:inspect",
  "recovery:inspect",
  "attach:inspect",
]);

export function isReadOnly(operation: Operation): boolean {
  if (operation.family === "attach" && operation.action === "open")
    return (operation.mode ?? "observe") === "observe";
  return observations.has(`${operation.family}:${operation.action}`);
}
