import { homedir } from "node:os";

import type { CommandContext } from "../../cli/command.js";
import { currentHooks, restartNotes } from "../hook-freshness.js";
import { sessionSnapshot } from "../snapshot.js";
import { statusLines } from "../status.js";
import type { LiveRecord } from "../types.js";
import { wakeableBy } from "../wake/probe.js";
import { storeFrom } from "./verbs.js";

export function status(context: CommandContext): number {
  const { store, leases, root } = storeFrom(context);
  const current = currentHooks(root);
  const home = context.env["HOME"] ?? homedir();
  const wakeable = (record: LiveRecord) =>
    wakeableBy(record, { home, env: context.env });
  if (context.args.flags.has("json")) {
    const records = store.registry.list();
    const restart = restartNotes(records, current);
    const wake = Object.fromEntries(
      records
        .filter((record) => record.live)
        .map((record) => [record.session, wakeable(record)]),
    );
    context.ui.data(
      JSON.stringify({ ...sessionSnapshot(store, leases), restart, wake }) +
        "\n",
    );
    return 0;
  }
  const lines = statusLines(store, context.cwd, leases, current, wakeable);
  if (lines.length > 0) context.ui.data(lines.join("\n") + "\n");
  if (lines.length === 0) context.ui.line("no live sessions");
  return 0;
}
