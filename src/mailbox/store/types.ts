import type { MailboxStore } from "./core.js";
export type StoreContext = Pick<
  MailboxStore,
  "config" | "database" | "now" | "run" | "assertBinding"
>;
