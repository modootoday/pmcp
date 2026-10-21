import { Marked } from "marked";
import { escape } from "../../page.mjs";
import { guides } from "./catalog.mjs";
import { manualLibraryDescriptors } from "../../library-skills/manual.mjs";

const manualSources = new Set(
  manualLibraryDescriptors.map(
    (entry) => `/${entry.path.slice("docs/".length)}`,
  ),
);

function resolveLink(href) {
  if (href.startsWith("#")) return href;
  // Web links and app deep links (the install page's Cursor and VS Code buttons) pass through.
  if (/^[a-z][a-z0-9+.-]*:/iu.test(href)) return href;
  const [file, fragment] = href.split("#");
  if (manualSources.has(file)) return href;
  if (file === "../README.md") return fragment ? `/#${fragment}` : "/";
  const guide = guides.find((entry) => entry.source === file);
  if (!guide) throw new Error(`Unsupported guide link: ${href}`);
  return fragment ? `${guide.route}#${fragment}` : guide.route;
}

// GitHub's heading anchors, so a fragment link works the same on GitHub, in the npm package
// and on the site; a repeated heading gets -1, -2 as GitHub numbers it.
export function headingId(text, seen) {
  const base = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/gu, "-");
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

export function renderGuide(markdown) {
  const seen = new Map();
  const parser = new Marked({
    renderer: {
      html({ text }) {
        return escape(text);
      },
      code({ text }) {
        return `<pre><code>${escape(text)}</code></pre>\n`;
      },
      heading({ tokens, depth, text }) {
        const content = this.parser.parseInline(tokens);
        const id = headingId(text, seen);
        return `<h${depth} id="${escape(id)}">${content}</h${depth}>\n`;
      },
      table(token) {
        const cell = (entry, tag) =>
          `<${tag}>${this.parser.parseInline(entry.tokens)}</${tag}>`;
        const header = token.header.map((entry) => cell(entry, "th")).join("");
        const rows = token.rows
          .map(
            (row) =>
              `<tr>${row.map((entry) => cell(entry, "td")).join("")}</tr>`,
          )
          .join("\n");
        return `<div class="scroll"><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div>\n`;
      },
    },
    walkTokens(token) {
      if (token.type === "link") token.href = resolveLink(token.href);
      if (token.type === "image")
        throw new Error("Guide images require an explicit site asset mapping");
    },
  });
  return parser.parse(markdown, { async: false });
}
