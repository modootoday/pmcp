import { command } from "../process/command.js";
import { uncappedRequested } from "./admission.js";

// Sessions get systemd scopes on capped Linux only; elsewhere no unit ever exists to be active.
export function unitActive(unit: string, uncapped = false): boolean {
  if (process.platform !== "linux" || uncapped || uncappedRequested())
    return false;
  let state: string;
  try {
    state = command("systemctl", [
      "--user",
      "show",
      unit,
      "--property=ActiveState",
      "--value",
    ]).trim();
  } catch (error) {
    const failure = error as Error & { stderr?: unknown };
    if (/not found|could not be found|No such/i.test(String(failure.stderr)))
      return false;
    throw error;
  }
  return ["active", "activating", "deactivating"].includes(state);
}

export function stopUnit(unit: string, uncapped = false): void {
  if (!unitActive(unit, uncapped)) return;
  try {
    command("systemctl", ["--user", "stop", unit]);
  } catch (error) {
    const stderr = String((error as Error & { stderr?: unknown }).stderr);
    if (
      !stderr.includes(unit) ||
      !/not loaded|not found|could not be found/i.test(stderr)
    )
      throw error;
    if (unitActive(unit)) throw error;
  }
  if (unitActive(unit)) throw new Error("runtime_stop_unconfirmed");
}
