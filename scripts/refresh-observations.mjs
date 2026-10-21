#!/usr/bin/env node
// Fetch the ledger so pages do not retain claims the API no longer serves.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "docs", "observations.json");

const flag = process.argv.indexOf("--api");
const api = flag < 0 ? "https://api.pmcp.build" : process.argv[flag + 1];
if (!api) throw new Error("--api needs a base URL");

const PAGE = 200;
const MAX_PAGES = 50;

const examinations = [];
let before;
let disclaimer = "";
for (let fetched = 0; fetched < MAX_PAGES; fetched += 1) {
  const url = new URL("/v1/observations", api);
  url.searchParams.set("limit", String(PAGE));
  if (before) url.searchParams.set("before", before);
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`${api} answered ${response.status} for the ledger`);
  }
  const body = await response.json();
  if (!Array.isArray(body?.examinations)) {
    throw new Error("the response carries no examinations");
  }
  disclaimer = body.disclaimer ?? disclaimer;
  examinations.push(...body.examinations);
  if (!body.nextBefore) {
    before = undefined;
    break;
  }
  before = body.nextBefore;
}
if (before) throw new Error("the ledger did not end within the page budget");

// Require the disclaimer so example failures cannot be mistaken for upstream defects.
if (!disclaimer.includes("not a finding of safety")) {
  throw new Error("the ledger came back without its disclaimer");
}

// Reject incomplete evidence rather than render claims the run did not establish.
for (const entry of examinations) {
  if (typeof entry.packageName !== "string" || entry.packageName === "") {
    throw new Error("an examination names no package");
  }
  const where = `${entry.packageName}@${entry.packageVersion}`;
  if (typeof entry.policyDescriptor !== "string" || !entry.policyDescriptor) {
    throw new Error(`${where} carries no policy`);
  }
  if (typeof entry.versionExact !== "boolean") {
    throw new Error(`${where} does not say whether its version is exact`);
  }
  if (!["verified", "refused", "incomplete"].includes(entry.outcome)) {
    throw new Error(`${where} has an outcome this page cannot render`);
  }
  for (const observation of entry.observations ?? []) {
    if (!observation.evidence) {
      throw new Error(`${where} carries an observation with no evidence`);
    }
    if (!observation.stage) {
      throw new Error(`${where} carries an observation with no stage`);
    }
  }
}

const written = `${JSON.stringify({ disclaimer, examinations }, null, 2)}\n`;

let current = "";
try {
  current = readFileSync(target, "utf8");
} catch {
  current = "";
}
if (current !== written) writeFileSync(target, written);

console.log(
  JSON.stringify({
    examinations: examinations.length,
    observations: examinations.reduce(
      (total, entry) => total + (entry.observations?.length ?? 0),
      0,
    ),
    changed: current !== written,
  }),
);
