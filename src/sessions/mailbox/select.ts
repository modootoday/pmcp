import { basename, resolve } from "node:path";

import type { Message, Recipient } from "../types.js";

// worktree:<path> names a linked worktree; desk:<path> is its older spelling and still works.
const KINDS = ["session", "alias", "role", "worktree", "desk"] as const;
const isWorktree = (kind: string) => kind === "worktree" || kind === "desk";

// Selectors name who a message is for; anything else is refused when it is sent.
export function checkSelector(selector: string): string {
  if (selector === "all") return selector;
  const [kind, value] = splitSelector(selector);
  if (!(KINDS as readonly string[]).includes(kind) || !value)
    throw new Error(
      `--to ${selector}: use all, session:<id>, alias:<name>, role:<name> or worktree:<path>`,
    );
  return selector;
}

function splitSelector(selector: string): [string, string] {
  const at = selector.indexOf(":");
  if (at < 0) return [selector, ""];
  return [selector.slice(0, at), selector.slice(at + 1)];
}

// A worktree is named by its path when sent from the CLI, so relative paths are fixed then.
export function normalizeSelector(selector: string, cwd: string): string {
  const [kind, value] = splitSelector(checkSelector(selector));
  return isWorktree(kind) ? `${kind}:${resolve(cwd, value)}` : selector;
}

function matches(selector: string, recipient: Recipient): boolean {
  if (selector === "all") return true;
  const [kind, value] = splitSelector(selector);
  if (kind === "session")
    return !!recipient.session && recipient.session.startsWith(value);
  if (kind === "alias") return recipient.alias === value;
  if (kind === "role") return (recipient.roles ?? []).includes(value);
  if (!isWorktree(kind) || !recipient.worktree) return false;
  return recipient.worktree === value || basename(recipient.worktree) === value;
}

// A broadcast is news for the sessions running when it was sent; a session that starts later
// would otherwise answer old broadcasts before its first prompt (grok did, live).
function before(message: Message, recipient: Recipient): boolean {
  if (!recipient.since) return false;
  return Date.parse(message.createdAt) < Date.parse(recipient.since);
}

export function addressedTo(message: Message, recipient: Recipient): boolean {
  return message.to.some(
    (selector) =>
      matches(selector, recipient) &&
      !(selector === "all" && before(message, recipient)),
  );
}

// The sender never receives its own message, even one sent to all.
export function sentBy(message: Message, recipient: Recipient): boolean {
  const { session, alias } = message.from;
  if (session && session === recipient.session) return true;
  return !!alias && alias === recipient.alias;
}

// Inbox directory name: session ids are already safe; an alias is prefixed with @.
export function inboxKey(recipient: { session?: string; alias?: string }) {
  if (recipient.session) return recipient.session.replace(/[^\w-]/gu, "_");
  return `@${(recipient.alias ?? "operator").replace(/[^\w.-]/gu, "_")}`;
}
