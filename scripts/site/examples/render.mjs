import { Marked } from "marked";
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

export function renderExamples(examples) {
  const parser = new Marked({
    renderer: {
      html({ text }) {
        return escape(text);
      },
      heading({ depth, tokens }) {
        const level = Math.min(depth + 1, 6);
        return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>\n`;
      },
    },
  });
  const entries = examples
    .map(
      (
        example,
      ) => `<article id="${escape(example.slug)}" class="example-body docs-body">
    <p class="eyebrow">Shipped source / @modootoday/pmcp</p>
    <h2>${escape(example.name)}</h2>
    <p><a href="https://github.com/modootoday/pmcp/blob/main/${escape(example.path)}">Read the source file</a></p>
    ${parser.parse(example.body, { async: false })}
  </article>`,
    )
    .join("\n");
  return `<section class="section examples-page"><h1>Read a skill.<br />See what it carries.</h1>
    <p class="lede">These instructions ship with the public PMCP package. Your project's catalog comes from the packages and plugins it has installed.</p>
    <label class="search-box"><span>Find an example</span><input type="search" data-example-search placeholder="Try dependencies or catalog" /></label>
    <div class="results" data-example-results>${exampleResults(examples, "")}</div><p data-example-empty hidden>No example matches. Clear the search to see the shipped skill.</p>
    <div class="examples-content">${entries}</div>
  </section>`;
}
