export { MailboxService } from "./service.js";
export {
  MailboxStore,
  restoreBackup,
  HEARTBEAT_INTERVAL_MS,
  PRESENCE_TTL_MS,
} from "./store.js";
export { MailboxError, failure } from "./types.js";
export type {
  ActorCredential,
  Binding,
  MailboxConfig,
  Result,
} from "./types.js";
export {
  sendSchema,
  inboxSchema,
  messageSchema,
  operationSchema,
  sessionsSchema,
} from "./schemas.js";
export type { MailboxOperation } from "./schemas.js";
export { NotificationOutbox } from "./notifications.js";
export { createRecoveryBundle, restoreRecoveryBundle } from "./recovery.js";
export { registerMailboxTools } from "../tools/mailbox.js";
export { attachMailbox, type MailboxAttachmentOptions } from "./attachment.js";
export {
  mailboxConfigFrom,
  initializeMailboxConfig,
  readCredential,
  readBinding,
  writePrivateJson,
  writeBindingFile,
} from "./config.js";
