// The hook bundle resolves node:child_process here, so only events that spawn load it.
import type * as ChildProcess from "node:child_process";

const real = (): typeof ChildProcess =>
  process.getBuiltinModule("node:child_process");

export const spawnSync: typeof ChildProcess.spawnSync = ((
  ...args: Parameters<typeof ChildProcess.spawnSync>
) => real().spawnSync(...args)) as typeof ChildProcess.spawnSync;

export const spawn: typeof ChildProcess.spawn = ((
  ...args: Parameters<typeof ChildProcess.spawn>
) => real().spawn(...args)) as typeof ChildProcess.spawn;
