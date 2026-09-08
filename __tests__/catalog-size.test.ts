import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { expect, it } from "vitest";

/**
 * The index is downloaded whole so the question never leaves the machine.
 * That trade holds only while the index stays small, and the size at which it
 * stops holding is written down. Nothing measured it, so the threshold had no
 * way to fire.
 */
const REDESIGN_AT_BYTES = 5_000_000;

it("keeps the downloaded index under the size that would end this mechanism", () => {
  const raw = readFileSync(
    join(import.meta.dirname, "../docs/catalog.json"),
    "utf8",
  );
  const gzip = gzipSync(raw).length;
  const entries = (JSON.parse(raw) as { entries: unknown[] }).entries.length;
  const perEntry = Math.round(gzip / entries);

  // Reported rather than only asserted: the number that decides when this has
  // to be redesigned is the cost per entry, and a bare pass never shows it.
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
