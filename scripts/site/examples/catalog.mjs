import { readFileSync, readdirSync } from "node:fs";
import { parse } from "yaml";

export function shippedExamples(root) {
  return readdirSync(new URL("skills/", root))
    .sort()
    .map((slug) => {
      const path = `skills/${slug}/SKILL.md`;
      const source = readFileSync(new URL(path, root), "utf8");
      const parts = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(source);
      if (!parts) throw new Error(`Missing frontmatter in ${path}`);
      const metadata = parse(parts[1]);
      if (
        typeof metadata.name !== "string" ||
        typeof metadata.description !== "string"
      )
        throw new Error(`Missing skill metadata in ${path}`);
      return {
        slug,
        path,
        name: metadata.name,
        description: metadata.description,
        body: parts[2].trim(),
      };
    });
}
