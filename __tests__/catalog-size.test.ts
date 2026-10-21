import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { expect, it } from "vitest";

// Downloading the entire index remains viable only while its compressed size stays bounded.
const REDESIGN_AT_BYTES = 5_000_000;

it("keeps the downloaded index under the size that would end this mechanism", () => {
  const raw = readFileSync(
    join(import.meta.dirname, "../docs/catalog.json"),
    "utf8",
  );
  const gzip = gzipSync(raw).length;
  const entries = (JSON.parse(raw) as { entries: unknown[] }).entries.length;
  const perEntry = Math.round(gzip / entries);

  // Reporting cost per entry makes the redesign threshold observable before it fails.
  console.log(
    JSON.stringify({
      entries,
      gzipBytes: gzip,
      gzipBytesPerEntry: perEntry,
      entriesUntilRedesign: Math.floor(REDESIGN_AT_BYTES / perEntry),
    }),
  );

  expect(entries).toBeGreaterThan(0);
  expect(gzip).toBeLessThan(REDESIGN_AT_BYTES);
});
