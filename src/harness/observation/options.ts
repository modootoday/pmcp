import { integer } from "../validation.js";

export interface ReadOptions {
  lines?: number;
  maxBytes?: number;
  alternate?: boolean;
}

export function readOptions(input?: Record<string, unknown>): ReadOptions {
  if (input === undefined) return {};
  const allowed = ["lines", "maxBytes", "alternate"];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new Error("invalid_read_option");
  if (input.alternate !== undefined && typeof input.alternate !== "boolean")
    throw new Error("invalid_alternate");
  return {
    ...(input.lines === undefined
      ? {}
      : { lines: integer(input.lines, "lines", 1, 2000) }),
    ...(input.maxBytes === undefined
      ? {}
      : { maxBytes: integer(input.maxBytes, "max_bytes", 1, 65536) }),
    ...(input.alternate === undefined ? {} : { alternate: input.alternate }),
  };
}
