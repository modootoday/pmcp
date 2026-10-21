import {
  frontmatterObject,
  frontmatterText,
  metadataOf,
  type MetadataValue,
} from "../frontmatter.js";
export function readMetadata(source: string): Record<string, MetadataValue> {
  return metadataOf(frontmatterObject(source));
}
export function readFrontmatterText(source: string): string {
  return frontmatterText(source) ?? "";
}
