import type { z } from "zod";
import {
  inboxSchema,
  messageSchema,
  operationSchema,
  sendSchema,
  sessionsSchema,
  type MailboxOperation,
} from "../schemas.js";
import { MailboxStore } from "../store.js";
import { failure, MailboxError, type Binding, type Result } from "../types.js";
import { send } from "./send.js";
import { inbox } from "./inbox.js";
import { receipt } from "./receipt.js";
import { sessions } from "./sessions.js";
export class MailboxService {
  readonly store: MailboxStore;
  readonly binding: Binding;
  constructor(store: MailboxStore, binding: Binding) {
    this.store = store;
    this.binding = binding;
  }
  async call(
    operation: MailboxOperation,
    input: unknown,
  ): Promise<Result<object>> {
    try {
      operationSchema.parse(operation);
      let data: object;
      if (operation === "send") {
        data = await this.send(sendSchema.parse(input));
      } else if (operation === "inbox") {
        data = await this.inbox(inboxSchema.parse(input));
      } else if (operation === "read" || operation === "ack") {
        data = await this.receipt(
          messageSchema.parse(input).messageId,
          operation,
        );
      } else {
        sessionsSchema.parse(input);
        data = await this.sessions();
      }
      return { ok: true, data };
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        return failure(
          new MailboxError(
            "invalid_input",
            "Mailbox input does not match the operation schema",
          ),
        );
      }
      return failure(error);
    }
  }
  private send(input: z.output<typeof sendSchema>): Promise<object> {
    return send(this, input);
  }
  private inbox(input: z.output<typeof inboxSchema>): Promise<object> {
    return inbox(this, input);
  }
  private receipt(
    messageId: string,
    operation: "read" | "ack",
  ): Promise<object> {
    return receipt(this, messageId, operation);
  }
  private sessions(): Promise<object> {
    return sessions(this);
  }
}
