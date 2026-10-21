import { createFilesStore } from "../../sessions/files-store.js";
import { currentHooks, restartNotes } from "../../sessions/hook-freshness.js";
import { inboxKey } from "../../sessions/mailbox/select.js";
import { pathPmcp, pmcpCommand } from "../../sessions/projector-cli.js";
import { projectStateDir } from "../../sessions/state-dir.js";
import { lastWakes } from "../../sessions/wake/last.js";
import { wakeableBy } from "../../sessions/wake/probe.js";
import type { ProjectSpec } from "../spec.js";
import type { DoctorOptions, Finding } from "./types.js";

// A live session running hooks older than the projection is told to restart, not left guessing;
// with the mailbox on, each live session is also listed as wakeable or not.
export function sessionsDoctor(
  spec: ProjectSpec,
  options: Pick<DoctorOptions, "home" | "env">,
): Finding[] {
  const policy = spec.hookBundle?.policy;
  if (!policy) return [];
  const store = createFilesStore(
    projectStateDir(spec.root, policy.stateDir),
    policy.sessions,
  );
  const records = store.registry.list();
  const notes = restartNotes(records, currentHooks(spec.root));
  const check = "live sessions run the current hooks";
  const findings: Finding[] = [
    notes.length === 0
      ? { tool: "project", check, status: "ok" }
      : { tool: "project", check, status: "warn", detail: notes.join("; ") },
  ];
  if (!store.mailbox.settings.enabled) return findings;
  const live = records.filter((record) => record.live);
  const last = lastWakes(store.dir);
  const rows = live.map((record) => {
    const name = record.alias || record.session.slice(0, 8);
    const transport = wakeableBy(record, {
      home: options.home,
      env: options.env ?? {},
    });
    const wake = last.get(inboxKey({ session: record.session }));
    const tried = wake
      ? `; last wake ${wake.outcome} via ${wake.via} at ${wake.at}`
      : "";
    return `${name} (${record.runtime ?? "unknown"}): ${transport ?? "next event only"}${tried}`;
  });
  findings.push({
    tool: "project",
    check: "mailbox wake",
    status: "ok",
    ...(rows.length > 0 ? { detail: rows.join("; ") } : {}),
  });
  findings.push(pathFinding(spec.root, store.dir, options));
  return findings;
}

// Sessions run the pmcp their PATH finds; when that is not the projecting CLI, the mailbox names
// the projecting CLI instead, and the operator should know why (live: PATH pmcp 0.16.1).
function pathFinding(
  root: string,
  stateDir: string,
  options: Pick<DoctorOptions, "env">,
): Finding {
  const check = "pmcp on PATH is the projecting CLI";
  const command = pmcpCommand(root, stateDir, options.env?.["PATH"]);
  if (command === "pmcp") return { tool: "project", check, status: "ok" };
  const found = pathPmcp(options.env?.["PATH"]);
  const detail = found
    ? `PATH runs ${found}, not this project's pmcp; mailbox notices say ${command}`
    : `no pmcp on PATH; mailbox notices say ${command}`;
  return { tool: "project", check, status: "warn", detail };
}
