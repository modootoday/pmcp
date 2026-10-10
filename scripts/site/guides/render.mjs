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
  if (/^https?:\/\//u.test(href)) return href;
  const [file, fragment] = href.split("#");
  if (manualSources.has(file)) return href;
  if (file === "../README.md") return fragment ? `/#${fragment}` : "/";
  const guide = guides.find((entry) => entry.source === file);
  if (!guide) throw new Error(`Unsupported guide link: ${href}`);
  return fragment ? `${guide.route}#${fragment}` : guide.route;
}

export function renderGuide(markdown) {
  const parser = new Marked({
    renderer: {
      html({ text }) {
        return escape(text);
      },
      code({ text }) {
        return `<pre><code>${escape(text)}</code></pre>\n`;
      },
      heading({ tokens, depth }) {
        const content = this.parser.parseInline(tokens);
        return `<h${depth}>${content}</h${depth}>\n`;
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
