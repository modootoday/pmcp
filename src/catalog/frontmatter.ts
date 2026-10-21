import { bodyOf, frontmatterObject, stringFields } from "../frontmatter.js";
export function readFrontmatter(source: string): Record<string, string> {
  return stringFields(frontmatterObject(source));
}
export function readBody(source: string): string {
  return bodyOf(source);
}
