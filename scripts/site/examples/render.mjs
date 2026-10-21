import { escape } from "../layout/html.mjs";

export function exampleResults(examples, prefix = "/examples/") {
  return examples
    .map(
      (
        example,
      ) => `<a class="result" href="${prefix}#${escape(example.slug)}" data-example-result data-search="${escape(`${example.name} ${example.description}`.toLowerCase())}">
    <strong>${escape(example.name)}</strong><span>${escape(example.description)}</span><small>@modootoday/pmcp / ${escape(example.path)}</small>
  </a>`,
    )
    .join("\n");
}

// The SKILL.md bodies are written for agents; people get what each skill is for and where it
// ships, with a link to the exact file an agent reads.
export function renderExamples(examples) {
  const entries = examples
    .map(
      (
        example,
      ) => `<article id="${escape(example.slug)}" class="example-body docs-body">
    <p class="eyebrow">Ships with @modootoday/pmcp and its plugin</p>
    <h2>${escape(example.name)}</h2>
    <p>${escape(example.description)}</p>
    <p><a href="https://github.com/modootoday/pmcp/blob/main/${escape(example.path)}">Read the instructions an agent gets</a></p>
  </article>`,
    )
    .join("\n");
  return `<section class="section examples-page"><h1>Skills pmcp ships.<br />What each one is for.</h1>
    <p class="lede">These skills come with the npm package and with the pmcp plugin for Claude Code and Codex. An agent loads one when its task matches; your project's catalog also lists the skills its installed packages and plugins ship.</p>
    <label class="search-box"><span>Find a skill</span><input type="search" data-example-search placeholder="Try dependencies or catalog" /></label>
    <div class="results" data-example-results>${exampleResults(examples, "")}</div><p data-example-empty hidden>No skill matches. Clear the search to see them all.</p>
    <div class="examples-content">${entries}</div>
  </section>`;
}
