import type { SessionRecord } from "../../contracts.js";
import { Connection, type Reply } from "./connection.js";
import { RecordStore } from "./records.js";
import { cleanup, start, stop, type LaunchSpec } from "./lifecycle.js";
import { interrupt, validateText, write } from "./input.js";
import { read } from "./read.js";

export interface Attacher {
  pid: number | null;
  readOnly: boolean;
}

// The group's terminal sessions, held by its own pmcp-pty daemon.
export class Backend {
  readonly connection: Connection;
  readonly owner: string;
  readonly socket: string;
  readonly runDirectory: string;
  readonly metadataPath: string;

  constructor(readonly recordStore: RecordStore) {
    this.connection = new Connection(recordStore);
    this.owner = recordStore.owner;
    this.socket = recordStore.socket;
    this.runDirectory = recordStore.directory;
    this.metadataPath = recordStore.metadataPath;
  }

  records(): SessionRecord[] {
    return this.recordStore.all();
  }
  start(spec: LaunchSpec): Promise<SessionRecord> {
    return start(this.connection, spec);
  }
  inspect(id: string) {
    return this.connection.inspect(id);
  }
  read(
    id: string,
    options?: { lines?: number; maxBytes?: number; alternate?: boolean },
  ) {
    return read(this.connection, id, options);
  }
  validateText(text: string): void {
    validateText(text);
  }
  write(
    id: string,
    text: string,
    options: { submit?: boolean; lease?: string } = {},
  ) {
    return write(
      this.connection,
      id,
      text,
      options.submit === true,
      options.lease,
    );
  }
  interrupt(id: string, lease?: string): void {
    interrupt(this.connection, id, lease);
  }
  stop(id: string): void {
    stop(this.connection, id);
  }
  cleanup(): void {
    cleanup(this.connection);
  }

  attachers(id: string): Attacher[] {
    const session = this.inspect(id);
    const reply = this.connection.must({
      op: "attachers",
      id: session.ptySession,
    });
    return ((reply["attachers"] ?? []) as Reply[]).map((a) => ({
      pid: typeof a["pid"] === "number" ? a["pid"] : null,
      readOnly: a["read_only"] === true,
    }));
  }

  detach(id: string): number {
    const session = this.inspect(id);
    const reply = this.connection.must({
      op: "detach",
      id: session.ptySession,
    });
    return Number(reply["detached"] ?? 0);
  }

  // The harness lease mirrored into pmcp-pty, which then refuses input without its token.
  lease(id: string, token: string | null, previous?: string): void {
    const session = this.inspect(id);
    const request = token
      ? {
          op: "lease",
          id: session.ptySession,
          token,
          current: previous ?? token,
          ttl_ms: 90_000,
        }
      : {
          op: "lease",
          id: session.ptySession,
          current: previous,
          release: true,
        };
    this.connection.must(request);
  }
}

export function createBackend(): Backend {
  return new Backend(RecordStore.create());
}
export function openBackend(directory: string): Backend {
  return new Backend(new RecordStore(directory));
}
export function assertOwnedRecords(backend: Backend): void {
  backend.records();
}
export function writableClients(backend: Backend, sessionId: string): number {
  return backend.attachers(sessionId).filter((a) => !a.readOnly).length;
}
