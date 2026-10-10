import { z } from "zod";
import { RUNTIMES } from "../runtime.js";

export const operationSchema = z.enum([
  "send",
  "inbox",
  "read",
  "ack",
  "sessions",
]);
export type MailboxOperation = z.output<typeof operationSchema>;
export const sessionsSchema = z.object({}).strict();

export const actorIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const runtimeSchema = z.enum([...RUNTIMES, "operator"]);
export const credentialSchema = z
  .object({
    projectId: z.uuid(),
    actorId: actorIdSchema,
    secret: z.string().length(64),
  })
  .strict();
export const bindingSchema = z
  .object({
    projectId: z.uuid(),
    actorId: actorIdSchema,
    sessionId: z.uuid(),
    generation: z.number().int().positive(),
    secret: z.string().length(64),
  })
  .strict();
export const sendSchema = z
  .object({
    recipients: z
      .array(
        z
          .object({ actorId: actorIdSchema, sessionId: z.uuid().optional() })
          .strict(),
      )
      .min(1)
      .max(16),
    body: z
      .string()
      .min(1)
      .refine(
        (body) => Buffer.byteLength(body, "utf8") <= 65_536,
        "Body exceeds 64 KiB",
      ),
    idempotencyKey: z.string().min(1).max(128),
    replyToId: z.uuid().optional(),
  })
  .strict();
export const inboxSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(20),
    state: z.enum(["all", "unread", "unacknowledged"]).default("all"),
    threadId: z.uuid().optional(),
    cursor: z.string().max(2048).optional(),
  })
  .strict();
export const messageSchema = z.object({ messageId: z.uuid() }).strict();
export const cursorSchema = z
  .object({
    version: z.literal(1),
    projectId: z.uuid(),
    actorId: actorIdSchema,
    sessionId: z.uuid(),
    state: z.enum(["all", "unread", "unacknowledged"]),
    threadId: z.uuid().nullable(),
    after: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    upper: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export type SendInput = z.input<typeof sendSchema>;
export type InboxInput = z.input<typeof inboxSchema>;
