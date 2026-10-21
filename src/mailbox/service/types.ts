import type { MailboxStore } from "../store.js";
import type { Binding } from "../types.js";
export interface ServiceContext {
  readonly store: MailboxStore;
  readonly binding: Binding;
}
