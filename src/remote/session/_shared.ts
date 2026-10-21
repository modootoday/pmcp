export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
export const form = (fields: Record<string, string>): string =>
  new URLSearchParams(fields).toString();
export const FORM_HEADERS = {
  "content-type": "application/x-www-form-urlencoded",
};
export function scopeOf(
  scope: unknown,
  previous: string | undefined,
): {
  scope?: string;
} {
  if (typeof scope === "string") return { scope };
  if (previous !== undefined) return { scope: previous };
  return {};
}
