import type { RemoteCatalog } from "../../src/remote/catalog.js";

export function validateTopics(
  root: string,
  catalog: Pick<RemoteCatalog, "entries">,
): void;
