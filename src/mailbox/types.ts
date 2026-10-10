export type SqlValue = string | number | null;
export type Row = Record<string, unknown>;

export interface Database {
  exec(sql: string): void;
  get(sql: string, ...values: SqlValue[]): Row | undefined;
  all(sql: string, ...values: SqlValue[]): Row[];
  run(sql: string, ...values: SqlValue[]): void;
  close(): void;
}

export interface ActorCredential {
  projectId: string;
  actorId: string;
  secret: string;
}

export interface Binding {
  projectId: string;
  actorId: string;
  sessionId: string;
  generation: number;
  secret: string;
}

export interface MailboxConfig {
  projectId: string;
  databasePath: string;
  enabled: boolean;
}

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

export class MailboxError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "MailboxError";
  }
}

export function failure(error: unknown): Result<never> {
  if (error instanceof MailboxError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
    };
  }
  return {
    ok: false,
    error: {
      code: "internal_error",
      message: "Mailbox operation failed",
      retryable: false,
    },
  };
}
