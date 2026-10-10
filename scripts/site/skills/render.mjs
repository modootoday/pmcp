import { readFileSync } from "node:fs";
import { escape } from "../layout/html.mjs";
import { renderMarkdown } from "../layout/markdown.mjs";
import { skillRoute, skillSource, targets } from "./catalog.mjs";
import { standing } from "./standing.mjs";

function rows(entries) {
  return entries
    .map(
      (
        entry,
      ) => `<tr data-skill-row data-search="${escape(`${entry.title} ${entry.productId} ${entry.line.major}.x ${targets(entry)}`.toLowerCase())}">
    <td><a href="${skillRoute(entry)}">${escape(entry.title)} ${entry.line.major}.x</a><span class="tag">${escape(entry.line.status)}</span></td>
    <td><code>${escape(targets(entry))}</code></td>
    <td>${escape(entry.evidence.verifiedOn ?? "Not recorded")}<br />${entry.evidence.examplesExecuted} examples</td>
    </tr>`,
    )
    .join("\n");
}

function table(entries) {
  return `<div class="scroll"><table><thead><tr><th>Skill / major</th><th>Verified package version</th><th>Recorded verification</th></tr></thead><tbody>${rows(entries)}</tbody></table></div>`;
}

export function renderSkillIndex(catalog) {
  return `<h1>Free package skills</h1>
    <p>Instructions written for specific package versions. Read, download and use them without a PMCP account, subscription or payment.</p>
    <p>Choose the major that matches your project. Verification records describe the recorded run; they do not certify every future package release.</p>
    <p>For Python, Rust or Go libraries, <a href="/manual-library-skills/">choose free instructions and load a local collection explicitly</a>.</p>
    <label class="search-box"><span>Find a package</span><input id="skills-filter" data-skill-search type="search" placeholder="Try hono, zod or 4.x" hidden /><span id="skills-count" aria-live="polite">${catalog.entries.length} skill lines</span></label>
    <div data-skill-catalog>${table(catalog.entries)}<p data-skill-empty hidden>No matching package skill. Clear the filter to see all lines.</p></div>
    <p>Catalog snapshot: <code>${escape(catalog.revision)}</code>, published ${escape(catalog.publishedAt.slice(0, 10))}. <a href="/observations/">Read the sandbox ledger</a>.</p>`;
}

export function renderSkillProduct(entries) {
  return `<p><a href="/skills/">All free skills</a></p><h1>${escape(entries[0].title)}</h1>
    <p>${escape(entries[0].summary)}</p>
    <p>Each major has its own instructions. All listed lines are free to read and download without login.</p>${table(entries)}`;
}

export function renderSkillLine(entry) {
  const source = readFileSync(skillSource(entry), "utf8");
  const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, "");
  const route = skillRoute(entry);
  return `<p><a href="/skills/">All free skills</a> / <a href="/skills/${entry.productId}/">Other majors</a></p>
    <h1>${escape(entry.title)} ${entry.line.major}.x</h1><p>${escape(entry.summary)}</p>${standing(entry)}
    <dl><dt>For</dt><dd><code>${escape(targets(entry))}</code></dd><dt>Verified</dt><dd>${escape(entry.evidence.verifiedOn ?? "Not recorded")}, ${entry.evidence.examplesExecuted} examples executed</dd><dt>Skill package</dt><dd><code>${escape(entry.delivery.packageName)}@${escape(entry.delivery.version)}</code></dd></dl>
    <section class="skill-download"><h2>Use this skill for free</h2>
    <p>No PMCP login or subscription is required. Download the original instructions, or install the content-only archive with your project's package manager.</p>
    <p><a href="${route}SKILL.md" download>Download SKILL.md</a> · <a href="${route}package.tgz" download>Download package archive</a></p>
    <pre><code>npm install --save-dev https://pmcp.build${route}package.tgz</code></pre>
    <p>PMCP discovers the installed package's instructions. <a href="/guide/">Connect your runtime</a> after installation.</p>
    <details><summary>Archive integrity</summary><code>${escape(entry.delivery.integrity)}</code></details></section>
    <section class="skill-source"><h2>Complete instructions</h2>${renderMarkdown(body)}</section>`;
}
