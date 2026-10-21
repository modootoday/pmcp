// Compile configuration ahead of time so hook execution avoids TOML parsing.

import type { CompiledGuard, CompiledPolicy } from "./compiled.js";
import { bindingsFor, loweringFor } from "./compile/bindings.js";
import { legacyEntries, pinnedEntries, readCustom } from "./compile/custom.js";
import { readGuards } from "./compile/guards.js";
import { readChecks } from "./compile/checks.js";
import { readHooksTable } from "./compile/hooks-table.js";
import { readSessions } from "./compile/sessions.js";
import { asTable, type CompiledHooks, type Table } from "./compile/types.js";
import { readWorkspace } from "./compile/workspace.js";
import { readWorktreeSync } from "./compile/worktree-sync.js";
import { readMainlineDeliver } from "./compile/mainline-deliver.js";
import { RUNTIMES } from "./runtimes/index.js";
import { readLoggingTable } from "../logging/settings.js";

export type { CompiledHooks, CustomEntry } from "./compile/types.js";
export type { FeatureSource } from "./compile/workspace.js";

export interface ProjectTables {
  readonly hooks?: unknown;
  readonly sessions?: unknown;
  readonly git?: unknown;
  readonly logging?: unknown;
  readonly host?: unknown;
}

export interface CompileOptions {
  readonly root: string;
  readonly tools: ReadonlySet<string>;
}

// [host] turns shell.host_approval on, so agents cannot approve the host policy they could
// have written; a [hooks.guards.shell] host_approval entry, even mode off, takes over instead.
function hostGuard(host: unknown, guards: Table): CompiledGuard | null {
  if (host === undefined) return null;
  const shell = asTable(guards["shell"], "[hooks.guards.shell]");
  if (shell["host_approval"] !== undefined) return null;
  return { id: "shell.host_approval", mode: "deny", options: {} };
}

export function compileHooks(
  tables: ProjectTables,
  options: CompileOptions,
): CompiledHooks {
  const hooks = asTable(tables.hooks, "[hooks]");
  const table = readHooksTable(hooks, options.tools);
  const guardsTable = asTable(hooks["guards"], "[hooks.guards]");
  const entries = readCustom(options.root, hooks, guardsTable);
  const sessions = readSessions(tables.sessions, tables.git);
  const workspace = readWorkspace(tables.git, options.root);
  const deskSync = readWorktreeSync(tables, options.root);
  const directPush = readMainlineDeliver(tables, options.root);
  const host = hostGuard(tables.host, guardsTable);
  const enabled =
    table.enabled ||
    host !== null ||
    sessions.declared ||
    workspace.declared ||
    !!deskSync ||
    !!directPush;
  const legacy = legacyEntries(entries, enabled, table.targets);
  if (!enabled)
    return {
      policy: null,
      edits: [],
      files: [],
      legacy,
      sources: { "git.shared_checkout": workspace.sharedCheckout.source },
    };
  const shared = workspace.sharedCheckout.guard;
  const guards = [
    ...sessions.guards,
    ...(shared ? [shared] : []),
    ...(deskSync ? [deskSync] : []),
    ...(directPush ? [directPush] : []),
    ...(host ? [host] : []),
    ...readGuards(guardsTable),
    ...readChecks(hooks["checks"]),
  ];
  const asks = guards.some(
    (guard) => guard.mode === "ask" || guard.mode === "graded",
  );
  const policy: CompiledPolicy = {
    contract: 2,
    targets: table.targets,
    ...(table.emergencyOffFile
      ? { emergencyOffFile: table.emergencyOffFile }
      : {}),
    ...(sessions.stateDir ? { stateDir: sessions.stateDir } : {}),
    ...(table.errorLog ? { logFile: table.errorLog } : {}),
    log: { ...readLoggingTable(tables.logging), enabled: table.logEnabled },
    sessions: {
      staleMs: sessions.staleMs,
      keepBroadcasts: sessions.keepBroadcasts,
      // Only when on, so projects without a mailbox keep the same policy.json and hash.
      ...(sessions.mailbox?.enabled ? { mailbox: sessions.mailbox } : {}),
      // Only when declared, like the mailbox, so other projects keep the same policy.json.
      ...(sessions.leaseFiles ? { leaseFiles: sessions.leaseFiles } : {}),
      ...(sessions.gate ? { gate: sessions.gate } : {}),
    },
    guards,
    custom: pinnedEntries(options.root, entries, table.targets),
    lowering: loweringFor(table.targets, table.askFallback, asks),
  };
  // A runtime that runs another target's hooks projects nothing of its own, so no call runs twice.
  const projecting = table.targets.filter((id) => {
    const host = RUNTIMES[id].ridesOn?.runtime;
    return !host || !table.targets.includes(host);
  });
  const plans = projecting.map((id) => ({
    adapter: RUNTIMES[id],
    plan: { bindings: bindingsFor(policy, id) },
  }));
  const edits = plans.flatMap(({ adapter, plan }) => adapter.project(plan));
  const files = plans.flatMap(
    ({ adapter, plan }) => adapter.files?.(plan) ?? [],
  );
  return {
    policy,
    edits,
    files,
    legacy,
    sources: { "git.shared_checkout": workspace.sharedCheckout.source },
  };
}
