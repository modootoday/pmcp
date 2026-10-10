/**
 * skill:// resources: every file of every skill the caller may see. The tools,
 * the Skills extension and resource links all resolve here, over the same
 * caller-filtered catalog, so nothing a caller cannot list can be read.
 */

import { statSync } from "node:fs";

import {
  ResourceNotFoundError,
  ResourceTemplate,
  type McpServer,
} from "@modelcontextprotocol/server";

import { kindOf, type SkillEntry } from "./catalog.js";
import { listSkillFiles } from "./files/list.js";
import { readSkillFile } from "./files/read.js";
import { ownFile } from "./files/resolve.js";
import {
  resolveSkillFileUri,
  skillFileUri,
  SKILL_URI_AUTHORITY,
} from "./files/uri.js";
import { assetRoot } from "./marketplace.js";

/** The Skills extension's per-skill ceiling; one file never exceeds it either. */
export const RESOURCE_READ_BUDGET = 16 * 1024 * 1024;

const COMPLETION_LIMIT = 100;

function listing(entries: readonly SkillEntry[]) {
  return entries
    .filter((entry) => kindOf(entry) === "skill")
    .map((entry) => ({
      uri: skillFileUri(entry, ownFile(entry)),
      name: entry.name,
      description: entry.description,
      mimeType: "text/markdown",
      size: statSync(entry.path).size,
    }));
}

/** Skill names, then a skill's files, for a client completing {+path}. */
function complete(value: string, entries: readonly SkillEntry[]): string[] {
  const owner = entries.find((entry) => value.startsWith(`${entry.name}/`));
  if (!owner) {
    return entries
      .map((entry) => `${entry.name}/`)
      .filter((name) => name.startsWith(value))
      .slice(0, COMPLETION_LIMIT);
  }
  return listSkillFiles(assetRoot(owner))
    .files.map((file) => `${owner.name}/${file.path}`)
    .filter((path) => path.startsWith(value))
    .slice(0, COMPLETION_LIMIT);
}

export function registerSkillResources(
  server: McpServer,
  skills: () => readonly SkillEntry[],
): void {
  server.registerResource(
    "skill-files",
    new ResourceTemplate(`skill://${SKILL_URI_AUTHORITY}/{+path}`, {
      list: () => ({ resources: listing(skills()) }),
      complete: { path: (value) => complete(value, skills()) },
    }),
    {
      title: "Skill files",
      description:
        "Files of the skills this catalog serves: SKILL.md, references, scripts and assets.",
    },
    async (uri) => {
      const href = uri.toString();
      const found = resolveSkillFileUri(href, skills());
      if (!found) throw new ResourceNotFoundError(href);
      const file = readSkillFile(found.entry, found.file, RESOURCE_READ_BUDGET);
      if (!file.ok) throw new ResourceNotFoundError(href);
      return {
        contents: [
          file.kind === "text"
            ? { uri: href, mimeType: file.mimeType, text: file.text ?? "" }
            : { uri: href, mimeType: file.mimeType, blob: file.blob ?? "" },
        ],
      };
    },
  );
}
