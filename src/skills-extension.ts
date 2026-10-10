/**
 * The MCP Skills extension (SEP-2640): the entry builder and the skills/list and
 * skills/get methods. Kept as one import path for the package's public API.
 */

export {
  MAX_RESOURCES,
  MAX_SKILL_BYTES,
  extensionEntry,
  type SkillExtensionEntry,
  type SkillResource,
} from "./extension/entry.js";
export {
  SKILLS_EXTENSION,
  registerSkillsExtension,
  type SkillsExtensionOptions,
} from "./extension/register.js";
export { frontmatterObject } from "./frontmatter.js";
export { skillFileUri as skillUri } from "./files/uri.js";
