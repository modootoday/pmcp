// One JSON envelope for every --json result, built around what the command printed.

export interface EnvelopeError {
  readonly code: string;
  readonly message: string;
}

export interface Envelope {
  readonly schema: string;
  readonly ok: boolean;
  readonly data: unknown;
  readonly errors: readonly EnvelopeError[];
}

const CODE_NAMES: Readonly<Record<number, string>> = {
  1: "failure",
  2: "usage",
  3: "missing_optional",
  4: "differences",
  75: "busy",
};

export function exitName(code: number): string {
  return CODE_NAMES[code] ?? "failure";
}

export function schemaName(words: readonly string[]): string {
  return `pmcp.${words.join(".")}.v1`;
}

// A command prints one JSON value; a few print one per line, which become an array.
export function parseData(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split("\n").filter((line) => line.trim() !== "");
    try {
      return lines.map((line) => JSON.parse(line) as unknown);
    } catch {
      return trimmed;
    }
  }
}

export function envelope(
  words: readonly string[],
  code: number,
  printed: string,
  messages: readonly string[],
): Envelope {
  return {
    schema: schemaName(words),
    ok: code === 0,
    data: parseData(printed),
    errors: messages.map((message) => ({ code: exitName(code), message })),
  };
}
