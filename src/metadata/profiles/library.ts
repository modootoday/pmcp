import { z } from "zod";
import { skillFrontmatter, skillMetadataCore } from "../schema.js";

export const libraryMetadata = skillMetadataCore.extend({
  "target-version": z.string().min(1).optional(),
  ecosystem: z.enum(["npm", "pypi", "crates", "go"]).optional(),
  "target-identity": z.string().min(1).optional(),
  "selected-version": z.string().min(1).optional(),
  loading: z.enum(["manual", "automatic"]).optional(),
});
export const libraryProfile = skillFrontmatter.extend({
  metadata: libraryMetadata.optional(),
});
export function validateManualLibraryIdentity(
  front: unknown,
  descriptor: {
    ecosystem: string;
    library: string;
    version: string;
    path: string;
  },
) {
  const skill = libraryProfile.parse(front);
  const metadata = skill.metadata;
  if (!metadata) return false;
  return (
    skill.name === descriptor.path.split("/")[2] &&
    metadata.ecosystem === descriptor.ecosystem &&
    metadata["target-identity"] === descriptor.library &&
    metadata["selected-version"] === descriptor.version &&
    metadata.loading === "manual"
  );
}
