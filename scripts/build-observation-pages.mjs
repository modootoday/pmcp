#!/usr/bin/env node
/**
 * Writes the observation ledger page.
 *
 * Published whether or not a skill came out of the run, because a ledger of
 * only the packages we sell would be an advertisement. The wording lives in
 * `observations-page.mjs` so it can be exercised with a ledger that has
 * something in it; this file only decides where the bytes go.
 *
 * Run: node scripts/build-observation-pages.mjs [--check]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderLedger } from "./observations-page.mjs";
import { commit } from "./page.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "docs");
const check = process.argv.includes("--check");

const ledger = JSON.parse(
  readFileSync(join(docs, "observations.json"), "utf8"),
);
const written = [
  {
    file: join(docs, "observations", "index.html"),
    html: renderLedger(ledger),
  },
];

const changed = commit(written, { root, check });
console.log(
  JSON.stringify({
    examinations: (ledger.examinations ?? []).length,
    observations: (ledger.examinations ?? []).reduce(
      (total, entry) => total + entry.observations.length,
      0,
    ),
    changed,
    mode: check ? "check" : "write",
  }),
);
if (check && changed > 0) process.exitCode = 1;
