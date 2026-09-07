import { escape, page } from "./page.mjs";

/**
 * Rendering the observation ledger.
 *
 * Separate from the script that writes it so the wording can be exercised with
 * a ledger that has something in it. The live ledger starts empty, and the
 * part of this page that could do harm is the part that only renders once a
 * package has done something.
 */

/**
 * What each code means, in a sentence that describes the run rather than the
 * package. "Tried to reach the network" is a fact; "phones home" is a verdict,
 * and one run cannot support one.
 */
export const MEANS = {
  "install-scripts-declared":
    "declares a script that npm would run at install time",
  "network-attempted": "attempted a network connection",
  "write-refused": "attempted to write into its own project directory",
  "permission-refused": "attempted to read something it was not given",
  "memory-limit-reached": "was stopped at the memory limit",
  "cpu-allowance-spent": "used its whole CPU allowance",
  "deadline-exceeded": "was still running at the deadline",
  "repeated-kills": "was killed more than once inside a single run",
};

const OUTCOME = {
  verified: "every example ran",
  refused: "an example did not run",
  incomplete: "the run did not get far enough to judge",
};

// Only these two stages are the package on its own. The example code is ours,
// so an observation from it is a fact about the run.
export const PACKAGE_STAGES = new Set(["manifest", "install"]);

export const stageTag = (stage) =>
  PACKAGE_STAGES.has(stage)
    ? `<span class="tag">the package</span>`
    : `<span class="tag warn">our example</span>`;

function observationList(entry) {
  if (entry.observations.length === 0) {
    return `        <p>Nothing was observed in this run.</p>`;
  }
  return `        <ul class="observations">
${entry.observations
  .map(
    (observation) => `          <li>
            ${escape(MEANS[observation.code] ?? observation.code)}
            ${stageTag(observation.stage)}
            <code>${escape(observation.evidence)}</code>
          </li>`,
  )
  .join("\n")}
        </ul>`;
}

function entryBlock(entry) {
  const named = entry.versionExact
    ? `${entry.packageName}@${entry.packageVersion}`
    : `${entry.packageName} (${entry.packageVersion}, never resolved)`;
  return `      <section class="examination">
        <h2><code>${escape(named)}</code></h2>
        <p>
          Examined ${escape(entry.examinedAt.slice(0, 10))}.
          ${escape(OUTCOME[entry.outcome] ?? entry.outcome)}, across
          ${escape(String(entry.examplesRun))}
          ${entry.examplesRun === 1 ? "example" : "examples"}.
        </p>
${observationList(entry)}
        <details>
          <summary>The sandbox it ran in</summary>
          <pre><code>${escape(entry.policyDescriptor)}</code></pre>
        </details>
      </section>`;
}

export function renderLedger(ledger) {
  const examinations = [...(ledger.examinations ?? [])].sort((a, b) =>
    b.examinedAt.localeCompare(a.examinedAt),
  );
  return page({
    path: "/observations/",
    title: "What packages did in the sandbox — pmcp",
    description:
      "Every package examined while writing a skill, what it did under the sandbox policy, and what that does and does not mean.",
    body: `      <h1>What packages did in the sandbox</h1>
      <p>
        Writing a skill means installing a package nobody here has read and
        running code against it, in a container with no route out. That
        produces security observations as a by-product. They are worth more
        than the skill, so they are published here.
      </p>
      <p>
        Every package examined is listed, including the ones that never became
        a skill. A list of only what we sell would be an advertisement, and the
        package that got itself refused is the one worth reading about.
      </p>
      <div class="notice">
        <h2>What this is not</h2>
        <p>${escape(ledger.disclaimer)}</p>
        <p>
          Nothing here is inferred, scored, or taken from someone else's
          advisory feed. Each line is something that happened in a run we
          executed, quoted from that run's own output.
        </p>
      </div>
${
  examinations.length === 0
    ? `      <p>Nothing has been examined yet.</p>`
    : examinations.map(entryBlock).join("\n")
}`,
  });
}
