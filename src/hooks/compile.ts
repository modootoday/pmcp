// Compile configuration ahead of time so hook execution avoids TOML parsing.

import type { CompiledGuard, CompiledPolicy } from "./compiled.js";
import { bindingsFor, loweringFor } from "./compile/bindings.js";
import { legacyEntries, pinnedEntries, readCustom } from "./compile/custom.js";
import { readGuards } from "./compile/guards.js";
import { readExternal } from "./compile/external.js";
import { readOwnersGuard } from "./compile/owners.js";
import { readChecks } from "./compile/checks.js";
import { readHooksTable } from "./compile/hooks-table.js";
import { readHostLease } from "./compile/host-lease.js";
import { declaresPtyHost } from "../project/host-spec.js";
import { readSessions } from "./compile/sessions.js";
import { readOperatorSettings } from "../sessions/operator.js";
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
  readonly owners?: unknown;
}

export interface CompileOptions {
  readonly root: string;
  readonly tools: ReadonlySet<string>;
}

// [host] turns shell.host_approval on, so agents cannot approve the host policy they could
// have written; a [hooks.guards.shell] host_approval entry, even mode off, takes over instead.
function hostGuard(host: unknown, guards: Table): CompiledGuard | null {
  if (!declaresPtyHost(host)) return null;
  const shell = asTable(guards["shell"], "[hooks.guards.shell]");
  if (shell["host_approval"] !== undefined) return null;
  return { id: "shell.host_approval", mode: "deny", options: {} };
}

// Session governance turns pmcp.operator_verbs on, so a session cannot pause, resume or bypass
// the others; a [hooks.guards.pmcp] operator_verbs entry, even mode off, takes over instead.
function operatorGuard(declared: boolean, guards: Table): CompiledGuard | null {
  if (!declared) return null;
  const pmcp = asTable(guards["pmcp"], "[hooks.guards.pmcp]");
  if (pmcp["operator_verbs"] !== undefined) return null;
  return { id: "pmcp.operator_verbs", mode: "deny", options: {} };
}

export function compileHooks(
  tables: ProjectTables,
  options: CompileOptions,
): CompiledHooks {
  const hooks = asTable(tables.hooks, "[hooks]");
  const table = readHooksTable(hooks, options.tools);
  const guardsTable = asTable(hooks["guards"], "[hooks.guards]");
  const entries = readCustom(options.root, hooks, guardsTable);
  const external = readExternal(guardsTable["external"]);
  const sessions = readSessions(tables.sessions, tables.git);
  readOperatorSettings(tables.sessions, options.root);
  const operator = operatorGuard(sessions.declared, guardsTable);
  const workspace = readWorkspace(tables.git, options.root);
  const deskSync = readWorktreeSync(tables, options.root);
  const directPush = readMainlineDeliver(tables, options.root);
  const host = hostGuard(tables.host, guardsTable);
  const heavy = readHostLease(tables.host, options.root);
  const owned = readOwnersGuard(tables.owners);
  const enabled =
    table.enabled ||
    host !== null ||
    heavy !== null ||
    owned !== null ||
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
    ...(heavy ? [heavy] : []),
    ...(operator ? [operator] : []),
    ...(owned ? [owned] : []),
    ...readGuards(guardsTable),
    ...readChecks(hooks["checks"]),
  ];
  const asks =
    guards.some((guard) => guard.mode === "ask" || guard.mode === "graded") ||
    entries.some((entry) => entry.mode === "ask");
  const policy: CompiledPolicy = {
    contract: 2,
    targets: table.targets,
    ...(table.emergencyOffFile
      ? { emergencyOffFile: table.emergencyOffFile }
      : {}),
    ...(table.failure ? { failure: table.failure } : {}),
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
      ...(sessions.pauseFile ? { pauseFile: sessions.pauseFile } : {}),
      ...(sessions.gate ? { gate: sessions.gate } : {}),
    },
    guards,
    custom: pinnedEntries(options.root, entries, table.targets),
    ...(external.length > 0 ? { external } : {}),
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
