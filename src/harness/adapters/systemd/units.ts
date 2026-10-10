import { command } from "../process/command.js";

export function unitActive(unit: string): boolean {
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

export function stopUnit(unit: string): void {
  if (!unitActive(unit)) return;
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
