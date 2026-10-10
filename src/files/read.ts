/**
 * One skill file's bytes, typed. Text stays text; images, audio and other binary
 * go out as base64 so nothing is corrupted on the way. Nothing is ever executed.
 */

import { readFileSync, statSync } from "node:fs";

import type { SkillEntry } from "../catalog.js";
import { classify, type FileKind } from "../mime.js";
import { sha256 } from "./list.js";
import { servedBytes } from "./redact.js";
import { resolveSkillFile, type FileRefusal } from "./resolve.js";

/** Largest file returned whole. A skill needing more should split it. */
export const READ_BUDGET_BYTES = 256 * 1024;

export interface SkillFileContent {
  readonly ok: true;
  readonly name: string;
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly mimeType: string;
  readonly kind: FileKind;
  /** Set when kind is text. */
  readonly text?: string;
  /** Base64, set when kind is not text. */
  readonly blob?: string;
}

export type ReadResult =
  | SkillFileContent
  | FileRefusal
  | {
      readonly ok: false;
      readonly error: "over_budget";
      readonly detail: string;
    };

export function readSkillFile(
  entry: SkillEntry,
  wanted?: string,
  budget = READ_BUDGET_BYTES,
): ReadResult {
  const resolved = resolveSkillFile(entry, wanted);
  if (!resolved.ok) return resolved;
  const size = statSync(resolved.target).size;
  if (size > budget) {
    return {
      ok: false,
      error: "over_budget",
      detail: `${size} bytes > ${budget}`,
    };
  }
  const bytes = servedBytes(resolved.target, readFileSync(resolved.target));
  const { kind, mimeType } = classify(resolved.path, bytes);
  return {
    ok: true,
    name: entry.name,
    path: resolved.path,
    bytes: bytes.length,
    sha256: sha256(bytes),
    mimeType,
    kind,
    ...(kind === "text"
      ? { text: bytes.toString("utf8") }
      : { blob: bytes.toString("base64") }),
  };
}
