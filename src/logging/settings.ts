import { isLogLevel, type LogLevel } from "./levels.js";

export type RedactKind = "secret_values" | "prompt_text" | "env_values";
const REDACT_KINDS: readonly RedactKind[] = [
  "secret_values",
  "prompt_text",
  "env_values",
];

export interface LogSettings {
  readonly enabled: boolean;
  readonly level: LogLevel;
  readonly components: Readonly<Record<string, LogLevel>>;
  readonly maxFileMb: number;
  readonly keepDays: number;
  readonly redact: readonly RedactKind[];
}

export const DEFAULT_LOG_SETTINGS: LogSettings = {
  enabled: true,
  level: "info",
  components: {},
  maxFileMb: 20,
  keepDays: 14,
  redact: REDACT_KINDS,
};

const KEYS = [
  "level",
  "format",
  "max_file_mb",
  "keep_days",
  "redact",
  "components",
];

function level(value: unknown, where: string): LogLevel {
  if (!isLogLevel(value))
    throw new Error(`${where} must be error, warn, info, debug or trace`);
  return value;
}

function positive(value: unknown, where: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !(value > 0))
    throw new Error(`${where} must be a positive number`);
  return value;
}

export function readLoggingTable(raw: unknown): LogSettings {
  if (raw === undefined) return DEFAULT_LOG_SETTINGS;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("[logging] must be a table");
  const table = raw as Record<string, unknown>;
  const unknown = Object.keys(table).find((key) => !KEYS.includes(key));
  if (unknown) throw new Error(`[logging] unknown key ${unknown}`);
  if (table["format"] !== undefined && table["format"] !== "jsonl")
    throw new Error("[logging] format must be jsonl");
  const redact = table["redact"] ?? REDACT_KINDS;
  if (
    !Array.isArray(redact) ||
    !redact.every((kind) => REDACT_KINDS.includes(kind))
  ) {
    throw new Error(`[logging] redact must list ${REDACT_KINDS.join(", ")}`);
  }
  const components = (table["components"] ?? {}) as Record<string, unknown>;
  return {
    enabled: true,
    level:
      table["level"] === undefined
        ? "info"
        : level(table["level"], "[logging] level"),
    components: Object.fromEntries(
      Object.entries(components).map(([name, value]) => [
        name,
        level(value, `[logging.components] ${name}`),
      ]),
    ),
    maxFileMb: positive(table["max_file_mb"], "[logging] max_file_mb", 20),
    keepDays: positive(table["keep_days"], "[logging] keep_days", 14),
    redact: redact as RedactKind[],
  };
}

export function withEnvOverride(
  settings: LogSettings,
  value: string | undefined,
): LogSettings {
  if (!value) return settings;
  let next = settings;
  for (const part of value.split(",").map((item) => item.trim())) {
    const [name, given] = part.includes("=")
      ? part.split("=", 2)
      : [undefined, part];
    if (!isLogLevel(given)) continue;
    next = name
      ? { ...next, components: { ...next.components, [name]: given } }
      : { ...next, level: given };
  }
  return next;
}
