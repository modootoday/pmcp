// Leave foreign-edit decisions to the person because the mod must not enforce independent policy.
import { linkedWorktreeOf, nameOf } from "./model";
import type { SessionRecord } from "./reader/index";
import { state } from "./state";

function checkoutOf(target: string, records: readonly SessionRecord[]): string {
  let best = "";
  for (const record of records) {
    const root = record.worktree ?? "";
    if (root && target.startsWith(`${root}/`) && root.length > best.length) {
      best = root;
    }
  }
  const linked = linkedWorktreeOf(target, state.settings?.worktreeRoot);
  return linked.length > best.length && target !== linked ? linked : best;
}

export async function holdForeignEdit($: any, e: any, next: any): Promise<any> {
  const target = String(e.file_path ?? e.notebook_path ?? "");
  const records = state.snapshot.records;
  const mine = records.find((r) => r.session === state.self)?.worktree;
  const checkout = checkoutOf(target, records);
  // Choose the innermost checkout because linked worktrees may be nested under the main checkout.
  const owner = records.find(
    (r) =>
      r.session !== state.self && r.worktree === checkout && checkout !== mine,
  );
  if (!owner) return next(e);
  try {
    const answer = await $.ui.ask(
      `${nameOf(owner)} works in ${owner.worktree}. Edit ${target} anyway?`,
      ["Edit", "Cancel"],
    );
    if (answer === "Edit") return next(e);
  } catch {
    // Leave noninteractive warnings to hooks because no person is available for a mod prompt.
    return next(e);
  }
  return {
    deny: `${nameOf(owner)} works in ${owner.worktree}; the person declined this edit.`,
  };
}
