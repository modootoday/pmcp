// Use a fixed field order so logs remain comparable across CLI and hook processes.

import { LEVEL_RANK, type LogLevel } from "./levels.js";
import { redact } from "./redact.js";
import { DEFAULT_LOG_SETTINGS, type LogSettings } from "./settings.js";

export { isLogLevel, type LogLevel } from "./levels.js";

export interface LogFields {
  readonly component?: string;
  readonly trace?: string;
  readonly session?: string;
  readonly runtime?: string;
  readonly event?: string;
  readonly policy?: string;
}

export interface LogData {
  readonly verdict?: string;
  readonly duration_ms?: number;
  readonly [key: string]: unknown;
}

export interface Logger {
  enabled(level: LogLevel): boolean;
  child(fields: LogFields): Logger;
  error(msg: string, data?: LogData): void;
  warn(msg: string, data?: LogData): void;
  info(msg: string, data?: LogData): void;
  debug(msg: string, data?: LogData): void;
  trace(msg: string, data?: LogData): void;
}

export type LogSink = (line: string) => void;

function levelFor(
  settings: LogSettings,
  component: string | undefined,
): LogLevel {
  let name = component;
  while (name) {
    const level = settings.components[name];
    if (level) return level;
    const dot = name.lastIndexOf(".");
    name = dot < 0 ? undefined : name.slice(0, dot);
  }
  return settings.level;
}

export function createLogger(
  sink: LogSink,
  settings: LogSettings | LogLevel = DEFAULT_LOG_SETTINGS,
  fields: LogFields = {},
): Logger {
  const resolved =
    typeof settings === "string"
      ? { ...DEFAULT_LOG_SETTINGS, level: settings }
      : settings;
  const limit = LEVEL_RANK[levelFor(resolved, fields.component)];
  const enabled = (at: LogLevel) => resolved.enabled && LEVEL_RANK[at] <= limit;
  const write = (at: LogLevel, msg: string, data?: LogData) => {
    if (!enabled(at)) return;
    const { verdict, duration_ms, ...rest } = data ?? {};
    const record = {
      ts: new Date().toISOString(),
      level: at,
      component: fields.component,
      trace: fields.trace,
      runtime: fields.runtime,
      event: fields.event,
      session: fields.session,
      policy: fields.policy,
      verdict,
      duration_ms,
      msg,
      data:
        Object.keys(rest).length > 0
          ? redact(rest, resolved.redact)
          : undefined,
    };
    try {
      sink(JSON.stringify(record));
    } catch {
      // Logging never changes a hook's answer.
    }
  };
  return {
    enabled,
    child: (more) => createLogger(sink, resolved, { ...fields, ...more }),
    error: (msg, data) => write("error", msg, data),
    warn: (msg, data) => write("warn", msg, data),
    info: (msg, data) => write("info", msg, data),
    debug: (msg, data) => write("debug", msg, data),
    trace: (msg, data) => write("trace", msg, data),
  };
}

export const silentLogger: Logger = createLogger(() => {}, {
  ...DEFAULT_LOG_SETTINGS,
  enabled: false,
});
