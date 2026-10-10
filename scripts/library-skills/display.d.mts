import type { RemoteEntry } from "../../src/remote/catalog.js";

export function skillDisplayTitle(
  targets: ReadonlyArray<Pick<RemoteEntry["targets"][number], "packageName">>,
): string;

export function validateSkillDisplayTitles(
  entries: ReadonlyArray<Pick<RemoteEntry, "productId" | "title" | "targets">>,
): void;
