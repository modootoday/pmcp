/** MCP content blocks for skill files: inline by type, or as links to fetch. */

import type { BundleFile } from "../files/bundle.js";
import type { SkillFileContent } from "../files/read.js";
import { skillFileUri } from "../files/uri.js";

/** A file's bytes as the content block its type calls for. */
export function fileBlock(file: SkillFileContent) {
  if (file.kind === "text") {
    return { type: "text" as const, text: file.text ?? "" };
  }
  if (file.kind === "image" || file.kind === "audio") {
    return {
      type: file.kind,
      data: file.blob ?? "",
      mimeType: file.mimeType,
    };
  }
  return {
    type: "resource" as const,
    resource: {
      uri: skillFileUri({ name: file.name }, file.path),
      mimeType: file.mimeType,
      blob: file.blob ?? "",
    },
  };
}

/** A link resources/read resolves, so a host fetches the bytes itself. */
export const resourceLink = (file: BundleFile) => ({
  type: "resource_link" as const,
  uri: file.uri,
  name: file.path,
  mimeType: file.mimeType,
  size: file.bytes,
});
