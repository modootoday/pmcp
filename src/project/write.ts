import { randomUUID } from "node:crypto";
import {
  closeSync,
  fchmodSync,
  fsyncSync,
  lstatSync,
  openSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

function fileMode(path: string): number {
  try {
    const stat = lstatSync(path);
    if (stat.isFile()) return stat.mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return 0o666 & ~process.umask();
}

function syncDirectory(path: string): void {
  if (process.platform === "win32") return;
  const descriptor = openSync(dirname(path), "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function replaceFile(path: string, content: string): void {
  const mode = fileMode(path);
  const temporary = `${path}.${randomUUID()}.new`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    try {
      writeFileSync(descriptor, content);
      fchmodSync(descriptor, mode);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, path);
    syncDirectory(path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function replaceLink(path: string, target: string): void {
  const temporary = `${path}.${randomUUID()}.new`;
  try {
    symlinkSync(target, temporary);
    renameSync(temporary, path);
    syncDirectory(path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
