// Run fixture commands through the projected hook entry, as each wired runtime calls it, and
// compare the decisions with the expected ones. Commands are classified by the guards, never
// executed; state goes to a throwaway XDG_STATE_HOME and git variables are stripped, so neither
// the project's state nor a repository the caller is inside is touched.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { HOOK_DIRECTORY, HOOK_FILE, POLICY_FILE } from "../compiled.js";
import type { CompiledPolicy } from "../compiled.js";
import { RUNTIME_IDS, type RuntimeId } from "../contract.js";
import { RUNTIMES } from "../runtimes/index.js";

export type Verdict = "allow" | "deny" | "ask";
const VERDICTS: readonly string[] = ["allow", "deny", "ask"];

export interface SmokeCase {
  readonly name: string;
  readonly guard: string;
  readonly command: string;
  readonly cwd?: "linked-worktree";
  readonly expect: Verdict | Readonly<Partial<Record<RuntimeId, Verdict>>>;
}

export interface Fixtures {
  readonly cases: readonly SmokeCase[];
  // When present, the projected [hooks.failure] must equal it.
  readonly failure?: unknown;
}

export interface SmokeFinding {
  readonly where: string;
  readonly message: string;
}

export interface SmokeResult {
  readonly runtimes: readonly RuntimeId[];
  readonly guards: readonly string[];
  readonly cases: number;
  readonly findings: readonly SmokeFinding[];
}

const CASE_TIMEOUT_MS = 15_000;
const SESSION = "pmcp-hooks-smoke";
const REFUSING = new Set(["deny", "ask", "graded"]);

// [hooks.test] fixtures: the file pmcp project --check --smoke runs.
export function readTestTable(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("[hooks.test] must be a table");
  const unknown = Object.keys(value).find((key) => key !== "fixtures");
  if (unknown) throw new Error(`unknown [hooks.test] key ${unknown}`);
  const fixtures = (value as Record<string, unknown>)["fixtures"];
  if (fixtures === undefined) return undefined;
  if (typeof fixtures !== "string" || fixtures === "")
    throw new Error("[hooks.test] fixtures must be a path");
  return fixtures;
}

export function readFixtures(text: string): Fixtures {
  const value = JSON.parse(text) as unknown;
  const fail = (message: string): never => {
    throw new Error(`fixtures: ${message}`);
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("must be a JSON object with cases");
  const { cases, failure } = value as Record<string, unknown>;
  if (!Array.isArray(cases)) return fail("cases must be a list");
  for (const [index, item] of cases.entries()) {
    const where = `case ${index + 1}`;
    if (!item || typeof item !== "object") fail(`${where} must be an object`);
    const entry = item as Record<string, unknown>;
    for (const key of ["name", "guard", "command"])
      if (typeof entry[key] !== "string" || entry[key] === "")
        fail(`${where} needs ${key}`);
    if (entry["cwd"] !== undefined && entry["cwd"] !== "linked-worktree")
      fail(`${where} cwd can only be "linked-worktree"`);
    const want = entry["expect"];
    const ok =
      (typeof want === "string" && VERDICTS.includes(want)) ||
      (!!want &&
        typeof want === "object" &&
        !Array.isArray(want) &&
        Object.entries(want).every(
          ([runtime, verdict]) =>
            (RUNTIME_IDS as readonly string[]).includes(runtime) &&
            typeof verdict === "string" &&
            VERDICTS.includes(verdict),
        ));
    if (!ok)
      fail(
        `${where} expect must be allow, deny or ask, or a table of runtime to one of them`,
      );
  }
  return {
    cases: cases as SmokeCase[],
    ...(failure !== undefined ? { failure } : {}),
  };
}

export function expected(
  testCase: SmokeCase,
  runtime: RuntimeId,
): Verdict | undefined {
  return typeof testCase.expect === "string"
    ? testCase.expect
    : testCase.expect[runtime];
}

// A runtime's before_tool answer read as the verdict it carries; each adapter knows its shape.
export function verdictOf(
  runtime: RuntimeId,
  stdout: string,
): Verdict | "unreadable" {
  return RUNTIMES[runtime].readVerdict(stdout) ?? "unreadable";
}

// Guards that can refuse a shell call under the projected policy; observe, warn and off never do.
export function enforcedGuards(policy: CompiledPolicy): string[] {
  const builtIn = policy.guards
    .filter(
      (guard) => /^(?:shell|git)\./u.test(guard.id) && REFUSING.has(guard.mode),
    )
    .map((guard) => guard.id);
  const custom = policy.custom
    .filter(
      (entry) =>
        entry.event === "before_shell" && REFUSING.has(entry.mode ?? "deny"),
    )
    .map((entry) => `custom.${entry.name}`);
  return [...builtIn, ...custom].sort();
}

// Each enforced guard needs, per runtime, one case it refuses and one it lets through.
export function coverageGaps(
  cases: readonly SmokeCase[],
  guards: readonly string[],
  runtimes: readonly RuntimeId[],
): string[] {
  const gaps: string[] = [];
  for (const guard of guards)
    for (const runtime of runtimes) {
      const mine = cases
        .filter((c) => c.guard === guard)
        .map((c) => expected(c, runtime))
        .filter((verdict) => verdict !== undefined);
      if (!mine.some((verdict) => verdict !== "allow"))
        gaps.push(`${guard} (${runtime}): no refusing case`);
      if (!mine.some((verdict) => verdict === "allow"))
        gaps.push(`${guard} (${runtime}): no passing case`);
    }
  return gaps;
}

// The child environment: no git variable (a smoke run from a git hook would otherwise point the
// guards' git probes at the repository being committed) and a scratch state home.
export function isolatedEnv(
  env: Readonly<Record<string, string | undefined>>,
  stateHome: string,
): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env))
    if (value !== undefined && !key.startsWith("GIT_")) clean[key] = value;
  return {
    ...clean,
    XDG_STATE_HOME: stateHome,
    PMCP_HOOK_COMPILE_CACHE: "off",
  };
}

// Projected runtimes that answer a shell before_tool; a runtime riding on another target's
// hooks is called through the same entry with its own payload.
function wiredRuntimes(
  root: string,
  policy: CompiledPolicy,
  fail: (where: string, message: string) => void,
): RuntimeId[] {
  const wired: RuntimeId[] = [];
  for (const id of policy.targets) {
    const adapter = RUNTIMES[id];
    if (adapter.capabilities.events.before_tool === "unsupported") continue;
    const host = adapter.ridesOn?.runtime;
    const files = (
      host && policy.targets.includes(host) ? RUNTIMES[host] : adapter
    ).nativeFiles.map((native) => join(root, native.file));
    const entry = (file: string) =>
      existsSync(file) &&
      readFileSync(file, "utf8").includes(`${HOOK_DIRECTORY}/hook.mjs`);
    if (files.length > 0 && !files.some(entry)) {
      fail(
        id,
        "a [hooks] target whose native hook entry is missing; run pmcp project",
      );
      continue;
    }
    wired.push(id);
  }
  return wired;
}

// A repository with branch "held" checked out in a linked worktree, for guards that look at
// worktrees.
function linkedWorktree(base: string, env: Record<string, string>): string {
  const repo = join(base, "repo");
  const git = (cwd: string, ...args: string[]) => {
    const run = spawnSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd,
      env,
      encoding: "utf8",
    });
    if (run.status !== 0)
      throw new Error(`git ${args.join(" ")}: ${run.stderr.trim()}`);
  };
  git(base, "init", "-q", "-b", "main", repo);
  git(
    repo,
    "-c",
    "user.name=smoke",
    "-c",
    "user.email=smoke@example.invalid",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  );
  git(repo, "worktree", "add", "-q", join(base, "wt"), "-b", "held");
  return repo;
}

function runCase(
  root: string,
  runtime: RuntimeId,
  command: string,
  cwd: string,
  env: Record<string, string>,
): { got: Verdict | "unreadable" } | { problem: string } {
  const adapter = RUNTIMES[runtime];
  const payload = adapter.synthetic({
    cwd,
    session: SESSION,
    event: adapter.nativeEvent("before_tool") ?? "",
    command,
    tool: "shell",
  });
  const run = spawnSync(
    process.execPath,
    [join(root, HOOK_FILE), runtime, "before_tool"],
    {
      cwd: root,
      input: JSON.stringify(payload),
      encoding: "utf8",
      timeout: CASE_TIMEOUT_MS,
      env,
    },
  );
  if (run.error) return { problem: run.error.message };
  if (run.status !== 0)
    return { problem: `exit ${run.status}; a hook always exits 0` };
  return { got: verdictOf(runtime, run.stdout) };
}

export function smoke(
  root: string,
  fixtures: Fixtures,
  env: Readonly<Record<string, string | undefined>> = process.env,
): SmokeResult {
  const findings: SmokeFinding[] = [];
  const fail = (where: string, message: string) =>
    findings.push({ where, message });
  for (const file of [HOOK_FILE, POLICY_FILE])
    if (!existsSync(join(root, file))) fail(file, "missing; run pmcp project");
  if (findings.length > 0)
    return { runtimes: [], guards: [], cases: 0, findings };
  const policy = JSON.parse(
    readFileSync(join(root, POLICY_FILE), "utf8"),
  ) as CompiledPolicy;
  const runtimes = wiredRuntimes(root, policy, fail);
  const guards = enforcedGuards(policy);
  if (
    fixtures.failure !== undefined &&
    !isDeepStrictEqual(policy.failure, fixtures.failure)
  )
    fail(
      "[hooks.failure]",
      `expected ${JSON.stringify(fixtures.failure)}, projected ${JSON.stringify(policy.failure ?? null)}`,
    );
  for (const gap of coverageGaps(fixtures.cases, guards, runtimes))
    fail("coverage", gap);
  const scratch = mkdtempSync(join(tmpdir(), "pmcp-hooks-smoke-"));
  const childEnv = isolatedEnv(env, join(scratch, "state"));
  let executed = 0;
  try {
    let worktree: string | undefined;
    for (const testCase of fixtures.cases) {
      const cwd =
        testCase.cwd === "linked-worktree"
          ? (worktree ??= linkedWorktree(scratch, childEnv))
          : root;
      for (const runtime of runtimes) {
        const want = expected(testCase, runtime);
        if (!want) continue;
        executed += 1;
        const where = `${runtime} :: ${testCase.name}`;
        const result = runCase(root, runtime, testCase.command, cwd, childEnv);
        if ("problem" in result) fail(where, result.problem);
        else if (result.got !== want)
          fail(where, `expected ${want}, got ${result.got}`);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (runtimes.length === 0)
    fail("runtimes", "no projected runtime answers a shell before_tool");
  if (executed === 0) fail("cases", "0 cases executed");
  return { runtimes, guards, cases: executed, findings };
}
