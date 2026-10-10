import { readCredential, writeBindingFile } from "./config.js";
import { MailboxService } from "./service.js";
import { HEARTBEAT_INTERVAL_MS, MailboxStore } from "./store.js";
import type { MailboxConfig } from "./types.js";

export interface MailboxAttachmentOptions {
  readonly config: MailboxConfig;
  readonly actorFile: string;
  readonly runtime: string;
  readonly bindingFile?: string;
  readonly replaceSessionId?: string;
  readonly nativeSessionId?: string;
  readonly onExpired?: () => void;
}

export async function attachMailbox(options: MailboxAttachmentOptions) {
  const store = await MailboxStore.open(options.config);
  let binding;
  try {
    binding = await store.attach(
      readCredential(options.actorFile),
      options.runtime,
      options.replaceSessionId,
      options.nativeSessionId,
    );
    if (options.bindingFile) writeBindingFile(options.bindingFile, binding);
  } catch (error) {
    if (binding) await store.detach(binding);
    await store.close();
    throw error;
  }
  const current = binding;
  let shutdown: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (shutdown) return shutdown;
    clearInterval(heartbeat);
    shutdown = (async () => {
      try {
        await store.detach(current);
      } finally {
        await store.close();
      }
    })();
    return shutdown;
  };
  const heartbeat = setInterval(() => {
    void store.heartbeat(current).catch(() => {
      options.onExpired?.();
      void close().catch(() => undefined);
    });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();
  return { service: new MailboxService(store, current), close };
}
