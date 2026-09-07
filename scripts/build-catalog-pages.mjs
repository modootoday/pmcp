#!/usr/bin/env node
/**
 * Renders the published catalog into the pages a person reads.
 *
 * The input is the catalog the API serves, saved beside the pages, so a build
 * needs no network and the pages can be checked against their source. The
 * sibling brand renders its registry the same way, for the same reason: one
 * source, two surfaces, and a marketplace that needs no server.
 *
 * Run: node scripts/build-catalog-pages.mjs [--check]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { commit, escape, page } from "./page.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "docs");
const source = join(docs, "catalog.json");
const check = process.argv.includes("--check");

const catalog = JSON.parse(readFileSync(source, "utf8"));
const entries = [...(catalog.entries ?? [])].sort((a, b) =>
  a.productId.localeCompare(b.productId),
);

// A reader deciding whether to trust a package should not have to go looking
// for what it did while we were watching it.
const ledger = JSON.parse(
  readFileSync(join(docs, "observations.json"), "utf8"),
);
const examinationsOf = (packageName) =>
  (ledger.examinations ?? []).filter(
    (entry) => entry.packageName === packageName,
  );

/**
 * Only the manifest and install stages are the package on its own; the example
 * code is ours. Saying so on the skill page matters more than on the ledger,
 * because this is the page where a reader is thinking about one package.
 */
const PACKAGE_STAGES = new Set(["manifest", "install"]);

function observedOn(entry) {
  const runs = entry.targets.flatMap((target) =>
    examinationsOf(target.packageName),
  );
  if (runs.length === 0) return "";
  const seen = runs.flatMap((run) =>
    run.observations.map((observation) => ({
      ...observation,
      packageName: run.packageName,
    })),
  );
  return `      <h2>What it did in the sandbox</h2>
      <p>
        Verifying this skill meant installing the package and running code
        against it with no route out. ${
          seen.length === 0
            ? "Nothing was observed."
            : "This is what happened, quoted from the run."
        }
        <a href="/observations/">The full ledger</a> lists every package
        examined, including the ones that never became a skill.
      </p>
${
  seen.length === 0
    ? `      <p>
        Nothing observed is not a finding of safety. It means one run, under
        one policy, produced nothing to report.
      </p>`
    : `      <ul class="observations">
${seen
  .map(
    (observation) => `        <li>
          <code>${escape(observation.evidence)}</code>
          ${
            PACKAGE_STAGES.has(observation.stage)
              ? `<span class="tag">the package</span>`
              : `<span class="tag warn">our example</span>`
          }
        </li>`,
  )
  .join("\n")}
      </ul>`
}
`;
}

const written = [];
function emit(path, html) {
  const file = join(docs, path.slice(1), "index.html");
  written.push({ file, html });
}

const targetsOf = (entry) =>
  entry.targets
    .map(
      (target) => `${target.packageName}@${target.verifiedVersions.join(", ")}`,
    )
    .join("; ");

/**
 * The listing has to carry the standing too. A reader who can only learn it by
 * opening each page learns it about the one they opened.
 */
function markOf(entry) {
  const status = entry.line?.status;
  if (status === "recalled") return ` <span class="tag warn">recalled</span>`;
  if (status === "frozen") return ` <span class="tag">frozen</span>`;
  return "";
}

/**
 * Where a line stands, said before the contents rather than after: a reader
 * deciding whether to pay should meet a recall before meeting the sample that
 * makes them want it. The current line says nothing, so that the page which
 * does say something is the one worth reading.
 */
function standingOf(entry) {
  const line = entry.line;
  if (!line || line.status === "active") return "";

  if (line.status === "recalled" && line.recall) {
    return `      <div class="notice">
        <h2>This line has been recalled</h2>
        <p>
          A ${escape(line.recall.severity)} advisory covers the versions this
          skill is written for. The skill itself is not the vulnerability: what
          is unsafe is the range it applies to.
        </p>
        <p>${escape(line.recall.summary)}</p>
        <p>
          ${
            line.recall.reverifyAt
              ? `The fix is in <code>${escape(line.recall.reverifyAt)}</code>. Move there and this skill still applies.`
              : "No release in this line is unaffected. Move to a newer major."
          }
          <a href="${escape(line.recall.advisoryUrl)}">Read the advisory</a>.
        </p>
      </div>
`;
  }

  return `      <p class="notice">
        Written for <code>${escape(String(line.major))}.x</code>, which is no
        longer revised. The verification date below is where this line stopped,
        not a date that will move again.
      </p>
`;
}

emit(
  "/skills/",
  page({
    path: "/skills/",
    title: "Written skills — pmcp",
    description:
      "Authored skills for packages that ship none, each verified by executing its examples against the version it names.",
    body: `      <h1>Written skills</h1>
      <p>
        A skill here is written for one package and verified by running its
        examples against that package. The date and the count below are what
        the run produced, not a claim about it.
      </p>
      <p>
        Reading this page costs nothing. Installing a skill needs a
        <a href="/pricing/">subscription</a>.
      </p>
      <div class="scroll">
        <table>
          <thead>
            <tr><th>Skill</th><th>For</th><th>Verified</th></tr>
          </thead>
          <tbody>
${
  entries.length === 0
    ? `            <tr><td colspan="3">Nothing published yet.</td></tr>`
    : entries
        .map(
          (entry) =>
            `            <tr>
              <td><a href="/skills/${escape(entry.productId)}/">${escape(entry.title)}</a>${markOf(entry)}</td>
              <td><code>${escape(targetsOf(entry))}</code></td>
              <td>${escape(entry.evidence?.verifiedOn || "before this was recorded")}, ${escape(String(entry.evidence?.examplesExecuted ?? 0))} examples</td>
            </tr>`,
        )
        .join("\n")
}
          </tbody>
        </table>
      </div>`,
  }),
);

for (const entry of entries) {
  const preview = entry.preview;
  emit(
    `/skills/${entry.productId}/`,
    page({
      path: `/skills/${entry.productId}/`,
      title: `${entry.title} — pmcp`,
      description: entry.summary,
      body: `      <h1>${escape(entry.title)}</h1>
      <p>${escape(entry.summary)}</p>
${standingOf(entry)}      <dl>
        <dt>For</dt><dd><code>${escape(targetsOf(entry))}</code></dd>
        <dt>Verified</dt><dd>${escape(entry.evidence?.verifiedOn || "before this was recorded")}, ${escape(String(entry.evidence?.examplesExecuted ?? 0))} examples executed</dd>
        <dt>Package</dt><dd><code>${escape(entry.delivery.packageName)}@${escape(entry.delivery.version)}</code></dd>
      </dl>
${
  preview?.headings?.length
    ? `      <h2>What it covers</h2>
      <ul>
${preview.headings.map((heading) => `        <li>${escape(heading)}</li>`).join("\n")}
      </ul>`
    : ""
}
${
  preview?.example
    ? `      <h2>One example from this skill</h2>
      <p>
        This is the skill's own text, not a summary of it. It runs: that is what
        verifying means here.
      </p>
      <pre><code>${escape(preview.example)}</code></pre>`
    : `      <p>
        This entry was published before previews were recorded, so there is no
        sample to show. A later revision will carry one.
      </p>`
}
${observedOn(entry)}      <h2>Getting it</h2>
      <p>
        With a <a href="/pricing/">subscription</a>:
      </p>
      <pre><code>npx -y @modootoday/pmcp login
npx -y @modootoday/pmcp install ${escape(entry.delivery.packageName)}</code></pre>
      <p>
        It installs as a dev dependency of your project, and the
        <a href="/guide/">MCP server</a> finds it there like any other skill.
      </p>`,
    }),
  );
}

const changed = commit(written, { root, check });

console.log(
  JSON.stringify({
    entries: entries.length,
    pages: written.length,
    changed,
    mode: check ? "check" : "write",
  }),
);
if (check && changed > 0) process.exitCode = 1;
