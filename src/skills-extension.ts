// Keep one public extension import path so consumers need not depend on internal module layout.

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
