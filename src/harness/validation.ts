export function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_object");
  }
  return value as Record<string, unknown>;
}

export function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new Error(`invalid_${name}`);
  }
  return value;
}

export function integer(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(`invalid_${name}`);
  }
  return value;
}

export function strings(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw new Error(`invalid_${name}`);
  }
  return value.map((entry) => text(entry, name));
}

export function id(value: unknown, name: string): string {
  const result = text(value, name);
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(result)) throw new Error(`invalid_${name}`);
  return result;
}
