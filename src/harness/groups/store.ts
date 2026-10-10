import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { State } from "../contracts.js";
import { object } from "../validation.js";
import { validateState } from "./validation.js";

export function privateJson(path: string, value: unknown): void {
  const temporary = `${path}.${randomUUID()}.new`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, path);
  const directory = openSync(dirname(path), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

export function readPrivateJson(path: string): unknown {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 2_097_152)
      throw new Error("unsafe_state_file");
    if (stat.uid !== process.getuid?.()) throw new Error("foreign_state_file");
    return JSON.parse(readFileSync(descriptor, "utf8"));
  } finally {
    closeSync(descriptor);
  }
}

export class GroupStore {
  readonly path: string;
  readonly state: State;

  constructor(path: string) {
    this.path = realpathSync(path);
    this.state = validateState(readPrivateJson(path));
    const metadata = object(
      readPrivateJson(join(dirname(this.path), "harness.json")),
    );
    if (
      this.state.group.schemaVersion !== 1 ||
      this.state.group.owner !== metadata.owner
    ) {
      throw new Error("foreign_group");
    }
  }

  save(): void {
    validateState(this.state);
    privateJson(this.path, this.state);
  }

  session(id: string): void {
    if (!this.state.group.sessions.some((entry) => entry.id === id)) {
      throw new Error("foreign_session");
    }
  }
}
