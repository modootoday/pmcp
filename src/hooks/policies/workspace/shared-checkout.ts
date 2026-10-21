// Warn about shared-checkout edits because they can prevent every session from syncing main.

import { dirname } from "node:path";

import type { Decision, HookInput } from "../../contract.js";
import {
  checkoutOf,
  hasLinkedWorktrees,
  type Checkout,
} from "../../../sessions/checkout.js";
import { onlyKeys, pass, type Policy, type PolicyContext } from "../types.js";
import { claimantNotice, claimants } from "./claimants.js";
import { addTouched, stillDirty } from "./leftovers.js";

export interface SharedCheckoutOptions {
  readonly warnOnSession: boolean;
  readonly trackEdits: boolean;
  readonly warnClaimants: boolean;
}

type Context = PolicyContext<SharedCheckoutOptions>;

const shared = (checkout: Checkout | null): checkout is Checkout =>
  checkout !== null && checkout.main && hasLinkedWorktrees(checkout);

function flag(raw: Readonly<Record<string, unknown>>, key: string): boolean {
  const value = raw[key] ?? true;
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
  return value;
}

function sessionWarning(input: HookInput, ctx: Context): string[] {
  const checkout = checkoutOf(input.cwd);
  const record = ctx.store.registry.get(input.session.id);
  if (!ctx.options.warnOnSession || !shared(checkout) || record?.sharedWarned)
    return [];
  ctx.store.registry.upsert(input.session.id, { sharedWarned: true });
  return [
    `This session works in the shared checkout ${checkout.root}, not a linked worktree. Keep to reading, syncing and delivering here; make changes in a linked worktree (pmcp git worktree create) or a scratch worktree.`,
  ];
}

function leftovers(input: HookInput, ctx: Context): string[] {
  const record = ctx.store.registry.get(input.session.id);
  const touched = record?.sharedTouched ?? [];
  if (!ctx.options.trackEdits || !record?.sharedRoot || touched.length === 0)
    return [];
  const dirty = new Set(
    stillDirty(
      record.sharedRoot,
      touched.map((entry) => entry.path),
    ),
  );
  const left = touched.filter((entry) => dirty.has(entry.path));
  const key = left
    .map((entry) => entry.path)
    .sort()
    .join(",");
  ctx.store.registry.upsert(input.session.id, {
    sharedTouched: left,
    sharedNoticed: key,
  });
  if (left.length === 0 || key === record.sharedNoticed) return [];
  const listed = left
    .slice(0, 6)
    .map((entry) => entry.path)
    .join(", ");
  const more = left.length > 6 ? ", ..." : "";
  return [
    `You left ${left.length} uncommitted file(s) in the shared checkout ${record.sharedRoot}: ${listed}${more}. Syncing the shared main refuses while they stay; land them within this task or move them to a scratch worktree.`,
  ];
}

function onEdit(input: HookInput, ctx: Context): string[] {
  const target = input.tool?.paths[0];
  const checkout = target ? checkoutOf(dirname(target)) : null;
  if (!target || !checkout) return [];
  const lines: string[] = [];
  const others = ctx.options.warnClaimants
    ? claimants(ctx.store, input.session.id, checkout.root)
    : [];
  if (others.length > 0) lines.push(claimantNotice(checkout.root, others));
  if (!ctx.options.trackEdits || !shared(checkout)) return lines;
  const record = ctx.store.registry.get(input.session.id);
  ctx.store.registry.upsert(input.session.id, {
    sharedRoot: checkout.root,
    sharedTouched: addTouched(
      record?.sharedTouched ?? [],
      checkout.root,
      target,
    ),
    sharedEditNoticed: true,
  });
  if (!record?.sharedEditNoticed) {
    lines.push(
      `You are editing the shared checkout ${checkout.root}, not a linked worktree. Deliver this change within the task, or make it in a linked or scratch worktree; an edit left here blocks syncing the shared main.`,
    );
  }
  return lines;
}

function notices(input: HookInput, ctx: Context): string[] {
  if (input.event === "before_tool") return onEdit(input, ctx);
  const lines = sessionWarning(input, ctx);
  if (input.event === "prompt") lines.push(...leftovers(input, ctx));
  return lines;
}

export const sharedCheckout: Policy<SharedCheckoutOptions> = {
  id: "git.shared_checkout",
  events: ["session_start", "prompt", "before_tool"],
  tools: ["edit"],
  fail: "open",
  defaultMode: "warn",
  options(raw) {
    onlyKeys(raw, [
      "enabled",
      "warn_on_session",
      "track_edits",
      "warn_claimants",
    ]);
    return {
      warnOnSession: flag(raw, "warn_on_session"),
      trackEdits: flag(raw, "track_edits"),
      warnClaimants: flag(raw, "warn_claimants"),
    };
  },
  evaluate(input, ctx): Decision {
    if (!input.session.id) return pass;
    const lines = notices(input, ctx);
    return lines.length > 0 ? { context: lines } : pass;
  },
};
