import { parse } from "yaml";

export function parseFrontmatter(text: string): {
  front: unknown;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text);
  if (!match) return { front: null, body: text };
  // Accept string scalars to preserve existing catalog keyword values.
  return {
    front: parse(match[1]!, { schema: "failsafe" }),
    body: text.slice(match[0].length),
  };
}
