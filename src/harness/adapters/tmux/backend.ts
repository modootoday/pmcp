import type { SessionRecord } from "../../contracts.js";
import { Connection } from "./connection.js";
import { RecordStore } from "./records.js";
import { cleanup, start, stop, type LaunchSpec } from "./lifecycle.js";
import { interrupt, validateText, write } from "./input.js";
import { read } from "./read.js";

export class Backend {
  private readonly connection: Connection;
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
  write(id: string, text: string, options: { submit?: boolean } = {}) {
    return write(this.connection, id, text, options.submit === true);
  }
  interrupt(id: string): void {
    interrupt(this.connection, id);
  }
  stop(id: string): void {
    stop(this.connection, id);
  }
  cleanup(): void {
    cleanup(this.connection);
  }
  tmux(args: string[]): string {
    return this.connection.tmux(args);
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
  const clients = backend
    .tmux(["list-clients", "-F", "#{session_id}|#{client_readonly}"])
    .trim();
  if (!clients) return 0;
  return clients.split("\n").filter((line) => line === `${sessionId}|0`).length;
}
