import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { McpAuthError } from "../_shared.js";
import type { CredentialRecord, Environment } from "../types.js";
import { credentialRecord } from "./schema.js";

export function credentialDirectory(env: Environment = process.env): string {
  return join(
    env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
    "pmcp",
    "credentials",
  );
}

export function credentialPath(
  name: string,
  env: Environment = process.env,
): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name))
    throw new McpAuthError("Invalid MCP server name");
  return join(credentialDirectory(env), `${name}.json`);
}

export function privateDirectory(env: Environment): void {
  const dir = credentialDirectory(env);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (lstatSync(dir).isSymbolicLink())
    throw new McpAuthError("Credential directory must not be a symbolic link");
  chmodSync(dir, 0o700);
}

export function readCredentials(
  name: string,
  env: Environment = process.env,
): CredentialRecord {
  let fd: number;
  try {
    fd = openSync(
      credentialPath(name, env),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new McpAuthError("Cannot read private MCP credentials");
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 128 * 1024)
      throw new Error("permissions");
    return credentialRecord.parse(JSON.parse(readFileSync(fd, "utf8")));
  } catch {
    throw new McpAuthError(
      "Invalid MCP credential file or permissions; contents are redacted",
    );
  } finally {
    closeSync(fd);
  }
}

export function writeCredentials(
  name: string,
  record: CredentialRecord,
  env: Environment = process.env,
): void {
  privateDirectory(env);
  const path = credentialPath(name, env);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(record) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, path);
  } finally {
    try {
      unlinkSync(temporary);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export function clearCredentials(
  name: string,
  env: Environment = process.env,
): void {
  try {
    unlinkSync(credentialPath(name, env));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new McpAuthError("Cannot remove MCP credential file");
  }
}
