import type { FailureSettings } from "../dispatch/failure.js";
import type { AskFallback, CompiledPolicy } from "../compiled.js";
import { RUNTIME_IDS, type RuntimeId } from "../contract.js";
import type { FileEdit, ProjectedFile } from "../runtimes/types.js";

export type CustomTarget = RuntimeId;
export const CUSTOM_TARGETS: readonly CustomTarget[] = RUNTIME_IDS;

export interface CustomEntry {
  readonly name: string;
  readonly command: readonly string[];
  readonly targets: readonly CustomTarget[];
  readonly timeoutMs: number;
  readonly event:
    "before_shell" | "after_edit" | "stop" | "session_start" | "prompt";
  // deny | ask | warn | observe; "off" entries are dropped when read.
  readonly mode: CustomMode;
  // An installed program named by command[0], pinned by what its --version prints.
  readonly version?: string;
}

export type CustomMode = "deny" | "ask" | "warn" | "observe" | "off";

export interface HooksTable {
  readonly enabled: boolean;
  readonly targets: readonly RuntimeId[];
  readonly askFallback: AskFallback | "refuse";
  readonly logEnabled: boolean;
  readonly errorLog?: string;
  readonly emergencyOffFile?: string;
  readonly failure?: FailureSettings;
}

export interface CompiledHooks {
  readonly policy: CompiledPolicy | null;
  readonly edits: readonly FileEdit[];
  readonly files: readonly ProjectedFile[];

  readonly legacy: readonly CustomEntry[];

  readonly sources: Readonly<Record<string, "toml" | "auto" | "default-off">>;
}

export type Table = Readonly<Record<string, unknown>>;

export function asTable(value: unknown, where: string): Table {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${where} must be a table`);
  }
  return value as Table;
}
