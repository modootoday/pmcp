import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { PtyReply } from "../adapters/pty/client.js";
import { pickEnv } from "../../native/env-names.js";

// pmcp harness host up | down: start what the operator approved, through pmcp-pty, once.
// Idempotent: a running session is left alone, an exited one restarts only by its policy.

export type Call = (
  request: Readonly<Record<string, unknown>>,
  limitMs: number,
) => Promise<PtyReply>;

export interface ApprovedSession {
  readonly name: string;
  readonly profile: string;
  readonly cwd: string;
  readonly argv: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
  readonly restart: "no" | "on-exit";
  readonly max_restarts: number;
  readonly delivery_setup: boolean;
  readonly env?: readonly string[];
}

export interface HostRun {
  readonly root: string;
  readonly approvedDir: string;
  readonly journal: string;
  readonly call: Call;
  readonly now?: () => Date;
  // Where declared env names are read from: host up's own environment.
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface Step {
  readonly name: string;
  readonly action: "started" | "running" | "restarted" | "exited" | "refused";
  readonly detail?: string;
  readonly id?: string;
}

function approved(dir: string): {
  sessions: ApprovedSession[];
  roots: string[];
} {
  const host = JSON.parse(readFileSync(join(dir, "host.json"), "utf8"));
  const policy = JSON.parse(readFileSync(join(dir, "policy.json"), "utf8"));
  return { sessions: host.sessions ?? [], roots: policy.roots ?? ["."] };
}

const under = (dir: string, root: string) =>
  root === "." || dir === root || dir.startsWith(`${root}/`);

function record(run: HostRun, entry: Record<string, unknown>): void {
  mkdirSync(dirname(run.journal), { recursive: true, mode: 0o700 });
  const at = (run.now ?? (() => new Date()))().toISOString();
  appendFileSync(run.journal, `${JSON.stringify({ at, ...entry })}\n`, {
    mode: 0o600,
  });
}

// Restarts made since the session's last fresh start or stop, from the journal, so a crash
// loop stops at its limit while an operator's down and up starts the count again.
function restarts(journal: string): Map<string, number> {
  const counts = new Map<string, number>();
  let text = "";
  try {
    text = readFileSync(journal, "utf8");
  } catch {
    return counts;
  }
  for (const line of text.split("\n").filter(Boolean)) {
    const entry = JSON.parse(line) as { op?: string; name?: string };
    if (!entry.name) continue;
    if (entry.op === "restarted")
      counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
    if (entry.op === "started" || entry.op === "stopped")
      counts.set(entry.name, 0);
  }
  return counts;
}

type Listed = { id: string; alive: boolean };

async function listed(run: HostRun, name: string): Promise<Listed[]> {
  const reply = await run.call(
    { op: "list", labels: { "pmcp.host": name } },
    10_000,
  );
  return (reply["sessions"] ?? []) as Listed[];
}

// Declared env goes in the spawn request, so a session gets it whatever environment the daemon
// started with (a scope from an earlier up, or the operator's installed unit).
async function spawn(
  run: HostRun,
  s: ApprovedSession,
  env: Record<string, string>,
): Promise<PtyReply> {
  return run.call(
    {
      op: "spawn",
      name: s.name,
      argv: s.argv,
      cwd: join(run.root, s.cwd),
      profile: s.profile,
      labels: s.labels,
      delivery_setup: s.delivery_setup,
      ...(Object.keys(env).length > 0 ? { env } : {}),
    },
    30_000,
  );
}

async function upOne(
  run: HostRun,
  s: ApprovedSession,
  roots: readonly string[],
  done: ReadonlyMap<string, number>,
): Promise<Step> {
  if (!roots.some((root) => under(s.cwd, root)))
    return {
      name: s.name,
      action: "refused",
      detail: `cwd ${s.cwd} is not under the approved roots`,
    };
  const found = await listed(run, s.name);
  const live = found.find((x) => x.alive);
  if (live) return { name: s.name, action: "running", id: live.id };
  const exited = found.length > 0;
  if (exited) {
    const used = done.get(s.name) ?? 0;
    if (s.restart !== "on-exit" || used >= s.max_restarts)
      return {
        name: s.name,
        action: "exited",
        detail: `restart ${s.restart}, ${used} of ${s.max_restarts} used`,
      };
  }
  const picked = pickEnv(s.env ?? [], run.env ?? {});
  if (picked.missing.length > 0)
    return {
      name: s.name,
      action: "refused",
      detail: `env ${picked.missing.join(", ")} not set in the environment of host up`,
    };
  if (exited)
    for (const old of found)
      await run.call({ op: "remove", id: old.id }, 10_000);
  const reply = await spawn(run, s, picked.values);
  if (reply["ok"] !== true)
    return {
      name: s.name,
      action: "refused",
      detail: `${String(reply["code"])}: ${String(reply["message"])}`,
    };
  const action = exited ? "restarted" : "started";
  const id = String(reply["id"]);
  record(run, {
    op: action,
    name: s.name,
    id,
    pid: reply["pid"],
    instance: reply["instance"],
  });
  return { name: s.name, action, id };
}

export async function hostUp(run: HostRun): Promise<Step[]> {
  const { sessions, roots } = approved(run.approvedDir);
  const done = restarts(run.journal);
  const steps: Step[] = [];
  for (const s of sessions) steps.push(await upOne(run, s, roots, done));
  return steps;
}

// Stops and forgets every session the host started, so the next up starts them fresh; other
// pmcp-pty sessions stay. kill ends the whole process tree, HUP then KILL after the grace.
export async function hostDown(run: HostRun): Promise<Step[]> {
  const { sessions } = approved(run.approvedDir);
  const steps: Step[] = [];
  for (const s of sessions) {
    for (const x of await listed(run, s.name)) {
      if (x.alive) {
        await run.call({ op: "kill", id: x.id }, 10_000);
        const until = {
          op: "wait",
          id: x.id,
          until: ["exit"],
          timeout_ms: 10_000,
        };
        await run.call(until, 15_000);
      }
      await run.call({ op: "remove", id: x.id }, 10_000);
      steps.push({ name: s.name, action: "exited", id: x.id });
      record(run, { op: "stopped", name: s.name, id: x.id });
    }
  }
  return steps;
}
