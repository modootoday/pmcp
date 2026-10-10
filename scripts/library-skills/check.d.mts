import type { RemoteEntry } from "../../src/remote/catalog.js";

export function checkLibrarySkills(root: string): {
  entries: number;
  revision: string;
  drafts?: string[];
  manualPilots?: number;
};
export function verifyArchive(
  entry: RemoteEntry,
  bytes: Buffer,
  source?: string,
): {
  files: Map<string, Buffer>;
  source: string;
  name: string;
  manifest: Record<string, unknown>;
};
