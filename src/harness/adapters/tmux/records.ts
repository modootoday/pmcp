import { randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SessionRecord } from "../../contracts.js";
import { privateJson, readPrivateJson } from "../../groups/store.js";
import { object, text } from "../../validation.js";
import { resourceClaim } from "../docker/claims.js";

export function stateDirectory(): string {
  return join(
    process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"),
    "pmcp/harness",
  );
}

export function runtimeUnit(id: string): string {
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))
    throw new Error("invalid_session_id");
  return `pmcp-${id}.scope`;
}

export function budgetSlice(owner: string): string {
  runtimeUnit(owner);
  return `pmcp${owner.replaceAll("-", "")}.slice`;
}

export class RecordStore {
  readonly directory: string;
  readonly socket: string;
  readonly metadataPath: string;
  readonly configPath: string;
  readonly owner: string;

  constructor(directory: string) {
    const stat = lstatSync(directory);
    if (
      !stat.isDirectory() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o077) !== 0
    )
      throw new Error("unsafe_group_directory");
    this.directory = realpathSync(directory);
    this.socket = join(this.directory, "s");
    if (Buffer.byteLength(this.socket) > 100)
      throw new Error("socket_path_too_long");
    this.metadataPath = join(this.directory, "harness.json");
    this.configPath = join(this.directory, "tmux.conf");
    this.owner = text(
      object(readPrivateJson(this.metadataPath)).owner,
      "owner",
    );
    runtimeUnit(this.owner);
  }

  static create(): RecordStore {
    const root = stateDirectory();
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const directory = join(root, randomUUID().slice(0, 16));
    if (Buffer.byteLength(join(directory, "s")) > 100)
      throw new Error("socket_path_too_long");
    mkdirSync(directory, { mode: 0o700 });
    mkdirSync(join(directory, "sessions"), { mode: 0o700 });
    privateJson(join(directory, "harness.json"), {
      owner: randomUUID(),
      createdAt: new Date().toISOString(),
    });
    writeFileSync(
      join(directory, "tmux.conf"),
      [
        "set -g remain-on-exit on",
        "set -g history-limit 2000",
        "set -g default-terminal tmux-256color",
        "set -g status off",
        "set -g mouse off",
        "set -g destroy-unattached off",
        "",
      ].join("\n"),
      { flag: "wx", mode: 0o600 },
    );
    return new RecordStore(directory);
  }

  path(id: string): string {
    runtimeUnit(id);
    return join(this.directory, "sessions", `${id}.json`);
  }

  read(id: string): SessionRecord {
    const record = object(readPrivateJson(this.path(id)));
    if (
      record.id !== id ||
      record.owner !== this.owner ||
      record.socket !== this.socket ||
      record.unit !== runtimeUnit(id)
    )
      throw new Error("foreign_backend_record");
    for (const [field, pattern] of [
      ["paneId", /^%\d+$/],
      ["windowId", /^@\d+$/],
      ["tmuxSessionId", /^\$\d+$/],
      ["serverIdentity", /^\d+:\d+$/],
    ] as const) {
      if (!pattern.test(text(record[field], field)))
        throw new Error("invalid_terminal_identity");
    }
    if (!Number.isSafeInteger(record.panePid) || Number(record.panePid) < 1)
      throw new Error("invalid_pane_process");
    if (record.resource !== undefined)
      resourceClaim(record.resource, this.owner);
    return record as unknown as SessionRecord;
  }

  all(): SessionRecord[] {
    return readdirSync(join(this.directory, "sessions"))
      .filter((name) => name.endsWith(".json"))
      .map((name) => this.read(name.slice(0, -5)));
  }

  save(record: SessionRecord): void {
    privateJson(this.path(record.id), record);
  }
}
