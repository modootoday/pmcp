import { Marked } from "marked";
import { escape } from "./html.mjs";

export function renderMarkdown(body) {
  const parser = new Marked({
    renderer: {
      html({ text }) {
        return escape(text);
      },
      heading({ depth, tokens }) {
        const level = Math.min(depth + 1, 6);
        return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>\n`;
      },
      link({ href, tokens }) {
        const label = this.parser.parseInline(tokens);
        if (!/^(?:https?:\/\/|\/|#|\.\.?\/)/u.test(href)) return label;
        return `<a href="${escape(href)}">${label}</a>`;
      },
    },
  });
  return parser.parse(body, { async: false });
}
