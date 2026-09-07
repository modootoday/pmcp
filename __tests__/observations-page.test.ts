import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  MEANS,
  renderLedger,
  stageTag,
} from "../scripts/observations-page.mjs";

/**
 * The live ledger starts empty, so the part of this page that could do harm is
 * the part that only renders once a package has done something. It is
 * exercised here rather than waiting for the first package to trigger it in
 * production.
 */

const DISCLAIMER =
  "Each entry records what happened in one sandboxed run under the policy named beside it. It is not a judgement of the package, and the absence of an observation is not a finding of safety. Observations at the 'manifest' and 'install' stages are the package's own behaviour; an observation at an 'example-N' stage happened while running example code we wrote against the package, and may have been caused by that code rather than by the package.";

const ledger = {
  disclaimer: DISCLAIMER,
  examinations: [
    {
      id: "a",
      packageName: "reaches-out",
      packageVersion: "2.0.1",
      versionExact: true,
      examinedAt: "2026-09-07T10:00:00.000Z",
      policyDigest: "sha256:aaa",
      policyDescriptor: "run --network none --read-only",
      examplesRun: 1,
      outcome: "refused",
      observations: [
        {
          stage: "example-0",
          code: "network-attempted",
          evidence: "error: Unable to connect.",
        },
      ],
    },
    {
      id: "b",
      packageName: "hooks-install",
      packageVersion: "1.0.0",
      versionExact: true,
      examinedAt: "2026-09-06T10:00:00.000Z",
      policyDigest: "sha256:aaa",
      policyDescriptor: "run --network none --read-only",
      examplesRun: 2,
      outcome: "verified",
      observations: [
        {
          stage: "install",
          code: "install-scripts-declared",
          evidence: "postinstall: node ./setup.js",
        },
      ],
    },
    {
      id: "c",
      packageName: "never-resolved",
      packageVersion: "^3",
      versionExact: false,
      examinedAt: "2026-09-05T10:00:00.000Z",
      policyDigest: "sha256:aaa",
      policyDescriptor: "run --network none --read-only",
      examplesRun: 0,
      outcome: "incomplete",
      observations: [],
    },
  ],
};

const html: string = renderLedger(ledger);

it("says whose code did the thing it is reporting", () => {
  // Measured 20260907: a probe example calling fetch produced a
  // network-attempted row against left-pad, which had done nothing. Publishing
  // that as the package's behaviour would be a false accusation.
  const network = html.slice(html.indexOf("reaches-out"));
  expect(network.slice(0, network.indexOf("</section>"))).toContain(
    "our example",
  );

  const hooks = html.slice(html.indexOf("hooks-install"));
  expect(hooks.slice(0, hooks.indexOf("</section>"))).toContain("the package");
});

it("carries the disclaimer the API served rather than one of its own", () => {
  expect(html).toContain("not a finding of safety");
  expect(html).toContain("rather than by the package");
});

it("lists the package that was refused, not only the ones that verified", () => {
  // A ledger of what sold would be an advertisement.
  expect(html).toContain("reaches-out");
  expect(html).toContain("an example did not run");
});

it("does not print a range as though it were a version", () => {
  expect(html).toContain("never-resolved (^3, never resolved)");
  expect(html).not.toContain("never-resolved@^3");
});

it("describes runs and never reaches a verdict", () => {
  // Every phrase the page can print about an observation, checked against the
  // words that would turn a run into an accusation.
  const verdicts = ["malicious", "malware", "unsafe", "safe", "suspicious"];
  for (const meaning of Object.values(MEANS) as string[]) {
    for (const verdict of verdicts) expect(meaning).not.toContain(verdict);
  }
  expect(html).not.toMatch(/\bmalicious\b/u);
});

it("keeps the quoted evidence beside every claim", () => {
  expect(html).toContain("error: Unable to connect.");
  expect(html).toContain("postinstall: node ./setup.js");
});

it("treats an unknown stage as ours rather than the package's", () => {
  // The safe default when the vocabulary grows: attributing our own code to a
  // package is the error that cannot be taken back.
  expect(stageTag("something-new")).toContain("our example");
});

it("keeps the generated ledger page in step with the ledger it came from", () => {
  const result = execFileSync(
    process.execPath,
    [
      join(import.meta.dirname, "../scripts/build-observation-pages.mjs"),
      "--check",
    ],
    { encoding: "utf8" },
  );
  expect(JSON.parse(result).changed).toBe(0);
});

it("renders the empty ledger as nothing examined, not as nothing found", () => {
  const empty: string = renderLedger({
    disclaimer: DISCLAIMER,
    examinations: [],
  });
  expect(empty).toContain("Nothing has been examined yet");
  // Asserted on the renderer, not on the built page: the ledger fills up, and
  // a test that reads today's page is testing the data rather than the rule.
  expect(empty).not.toContain("Nothing was observed in this run");
});
