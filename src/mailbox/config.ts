import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { readConfig, type ProjectConfig } from "../config.js";
import { bindingSchema, credentialSchema } from "./schemas.js";
import { MailboxError, type Binding, type MailboxConfig } from "./types.js";

const sectionSchema = z
  .object({
    version: z.literal(1),
    enabled: z.boolean(),
    project_id: z.uuid(),
    state_dir: z.string().min(1).optional(),
  })
  .strict();

export function mailboxConfigFrom(
  project: ProjectConfig,
  env: Readonly<Record<string, string | undefined>> = process.env,
): MailboxConfig | undefined {
  if (project.raw.mailbox === undefined) return undefined;
  const parsed = sectionSchema.safeParse(project.raw.mailbox);
  if (!parsed.success)
    throw new MailboxError("invalid_config", "Invalid [mailbox] configuration");
  const section = parsed.data;
  const stateRoot = env.XDG_STATE_HOME ?? join(homedir(), ".local/state");
  const stateDir = section.state_dir
    ? resolve(project.dir, section.state_dir)
    : join(stateRoot, "pmcp/projects", section.project_id);
  return {
    projectId: section.project_id,
    enabled: section.enabled,
    databasePath: join(stateDir, "mailbox.sqlite"),
  };
}

export function initializeMailboxConfig(
  file: string,
  stateDirectory?: string,
): MailboxConfig {
  const path = resolve(file);
  const original = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  if (original !== undefined && readConfig(path).raw.mailbox !== undefined) {
    throw new MailboxError("mailbox_exists", "Mailbox is already configured");
  }
  const lines = [
    "[mailbox]",
    "version = 1",
    "enabled = true",
    `project_id = ${JSON.stringify(randomUUID())}`,
  ];
  if (stateDirectory)
    lines.push(`state_dir = ${JSON.stringify(stateDirectory)}`);
  const text = `${original ?? ""}\n${lines.join("\n")}\n`;
  mkdirSync(dirname(path), { recursive: true });
  if (original === undefined) {
    writeFileSync(path, text, { flag: "wx", mode: 0o600 });
  } else {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, text, { flag: "wx", mode: 0o600 });
      if (readFileSync(path, "utf8") !== original) {
        throw new MailboxError(
          "config_conflict",
          "Configuration changed during initialization",
        );
      }
      renameSync(temporary, path);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  return mailboxConfigFrom(readConfig(path))!;
}

function readPrivateJson(file: string): unknown {
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 4096) {
      throw new MailboxError(
        "unsafe_credential_file",
        "Use a private regular credential file of at most 4096 bytes",
      );
    }
    if (process.getuid && stat.uid !== process.getuid()) {
      throw new MailboxError(
        "unsafe_credential_file",
        "Credential file must belong to the current user",
      );
    }
    return JSON.parse(readFileSync(descriptor, "utf8"));
  } finally {
    closeSync(descriptor);
  }
}

export function readCredential(file: string) {
  return credentialSchema.parse(readPrivateJson(file));
}

export function readBinding(file: string) {
  return bindingSchema.parse(readPrivateJson(file));
}

export function writePrivateJson(file: string, value: object): void {
  mkdirSync(dirname(resolve(file)), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
}

export function writeBindingFile(file: string, binding: Binding): void {
  if (existsSync(file)) {
    const previous = readBinding(file);
    if (
      previous.projectId !== binding.projectId ||
      previous.actorId !== binding.actorId
    ) {
      throw new MailboxError(
        "binding_scope_conflict",
        "Binding file belongs to another actor or project",
      );
    }
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writePrivateJson(temporary, binding);
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}
