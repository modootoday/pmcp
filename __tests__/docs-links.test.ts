import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

// The Markdown the npm package ships, which readers open on GitHub and in node_modules.
function shipped(): string[] {
  const docs = readdirSync(join(root, "docs"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => `docs/${name}`);
  const skills = readdirSync(join(root, "skills")).map(
    (name) => `skills/${name}/SKILL.md`,
  );
  return ["README.md", "SECURITY.md", "CONTRIBUTING.md", ...docs, ...skills];
}

const links = (text: string) =>
  [...text.matchAll(/\]\(([^)\s]+)\)/gu)].map((match) => match[1]!);

// Release notes live on GitHub Releases; the changelog file is gone and must not come back
// as a link a reader follows into nothing.
it("never links the removed CHANGELOG.md", () => {
  const found = shipped().filter((file) =>
    links(readFileSync(join(root, file), "utf8")).some((href) =>
      href.split("#")[0]!.endsWith("CHANGELOG.md"),
    ),
  );
  expect(found).toEqual([]);
});

it("resolves every relative link in the shipped Markdown", () => {
  const broken: string[] = [];
  for (const file of shipped()) {
    for (const href of links(readFileSync(join(root, file), "utf8"))) {
      if (/^([a-z][a-z0-9+.-]*:|#|\/)/iu.test(href)) continue;
      const path = href.split("#")[0]!;
      if (!existsSync(join(root, dirname(file), path)))
        broken.push(`${file} -> ${href}`);
    }
  }
  expect(broken).toEqual([]);
});
