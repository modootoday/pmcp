import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

import { CLI, leaseToml, project, scratch } from "./fixture.js";

const TRAPS_TERM =
  "process.on('SIGTERM',()=>{console.error('job stopped');process.exit(1)});console.error('job up');setInterval(()=>{},1000)";

it("answers with the job's exit code when the caller's deadline closes the pipes", () => {
  const { base, dir, env } = scratch();
  const cwd = project(base, leaseToml(dir));
  const result = spawnSync(
    "bun",
    [CLI, "heavy", "--", process.execPath, "-e", TRAPS_TERM],
    { cwd, env, encoding: "utf8", timeout: 4000 },
  );
  expect((result.error as NodeJS.ErrnoException | undefined)?.code).toBe(
    "ETIMEDOUT",
  );
  expect(result.stderr).toContain("job up");
  expect(result.status).toBe(1);
}, 30_000);
