export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";

export const LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && Object.hasOwn(LEVEL_RANK, value);
}
