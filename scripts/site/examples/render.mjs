import { escape } from "../layout/html.mjs";
import { summaries } from "./summaries.mjs";

// The built-in skills follow the /skills/ catalog: a list page with a filter, and one detail
// page per skill. The SKILL.md bodies are written for agents and stay on GitHub.
export const exampleRoute = (example) => `/examples/${example.slug}/`;
const sourceUrl = (example) =>
  `https://github.com/modootoday/pmcp/blob/main/${example.path}`;

export function summary(example) {
  const line = summaries[example.slug];
  if (!line) throw new Error(`No /examples/ summary for ${example.slug}`);
  return line;
}

export function exampleResults(examples) {
  return examples
    .map(
      (
        example,
      ) => `<a class="result" href="${exampleRoute(example)}" data-example-result data-search="${escape(`${example.name} ${example.description}`.toLowerCase())}">
    <strong>${escape(example.name)}</strong><span>${escape(summary(example))}</span><small>@modootoday/pmcp / ${escape(example.path)}</small>
  </a>`,
    )
    .join("\n");
}

export function renderExamples(examples) {
  const rows = examples
    .map(
      (
        example,
      ) => `<tr data-skill-row data-search="${escape(`${example.name} ${example.description}`.toLowerCase())}">
    <td><a href="${exampleRoute(example)}">${escape(example.name)}</a></td>
    <td>${escape(summary(example))}</td>
    </tr>`,
    )
    .join("\n");
  return `<h1>Skills pmcp ships</h1>
    <p>These skills come with the npm package and with the pmcp plugin for Claude Code and Codex. An agent loads one when its task matches; your project's catalog also lists the skills its installed packages and plugins ship.</p>
    <label class="search-box"><span>Find a skill</span><input data-skill-search type="search" placeholder="Try worktree, browser or catalog" hidden /><span id="skills-count" data-unit="skills" aria-live="polite">${examples.length} skills</span></label>
    <div data-skill-catalog><div class="scroll"><table><thead><tr><th>Skill</th><th>What it is for</th></tr></thead><tbody>${rows}</tbody></table></div><p data-skill-empty hidden>No matching skill. Clear the filter to see them all.</p></div>`;
}

export function renderExample(example) {
  return `<p><a href="/examples/">All built-in skills</a></p>
    <h1>${escape(example.name)}</h1><p>${escape(example.description)}</p>
    <dl><dt>Ships with</dt><dd><code>@modootoday/pmcp</code> and its plugin for Claude Code and Codex</dd><dt>Source</dt><dd><code>${escape(example.path)}</code></dd></dl>
    <p><a href="${sourceUrl(example)}">Read the instructions an agent gets</a></p>`;
}
