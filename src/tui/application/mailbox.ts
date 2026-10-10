import { readConfig } from "../../config.js";
import { mailboxConfigFrom, readCredential } from "../../mailbox/config.js";
import { MailboxStore } from "../../mailbox/store.js";
import { MailboxService } from "../../mailbox/service.js";
import type { Row } from "../../mailbox/types.js";
import type { View } from "../contracts.js";
import type { ViewContext } from "./context.js";
import { releaseControl } from "./control.js";

export async function observeMailbox(
  view: View,
): Promise<{ configured: boolean; items: Row[] }> {
  if (!view.mailbox) return { configured: false, items: [] };
  const config = mailboxConfigFrom(readConfig(view.mailbox.config));
  if (!config?.enabled) throw new Error("mailbox_disabled");
  const store = await MailboxStore.open(config);
  try {
    const binding = await store.attach(
      readCredential(view.mailbox.actorFile),
      "operator",
    );
    try {
      const result = await new MailboxService(store, binding).call("inbox", {});
      if (!result.ok) throw new Error(result.error.code);
      const data = result.data as { items: Row[] };
      return {
        configured: true,
        items: data.items.map((item) => ({
          messageId: item.messageId,
          threadId: item.threadId,
          replyToId: item.replyToId,
          senderActorId: item.senderActorId,
        })),
      };
    } finally {
      await store.detach(binding);
    }
  } finally {
    await store.close();
  }
}

export async function observeInbox(context: ViewContext): Promise<void> {
  if (!context.view.mailbox) throw new Error("mailbox_not_configured");
  await observeMailbox(context.view);
  await releaseControl(context);
  context.renderer.worker(
    context.view,
    context.renderer.panel("mailbox"),
    "mailbox",
  );
}
