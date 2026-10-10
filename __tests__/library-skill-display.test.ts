import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { readArchive } from "../scripts/library-skills/archive.mjs";
import {
  skillDisplayTitle,
  validateSkillDisplayTitles,
} from "../scripts/library-skills/display.mjs";
import { preparePublication } from "../scripts/library-skills/publication.mjs";
import { sourceDigest } from "../scripts/library-skills/source.mjs";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function target(packageName: string) {
  return { packageName, range: "^1.0.0", verifiedVersions: ["1.2.3"] };
}

it.each(["react", "react-dom", "@vitejs/plugin-react"])(
  "uses the exact npm identity %s without a brand or version suffix",
  (packageName) => {
    expect(skillDisplayTitle([target(packageName)])).toBe(packageName);
  },
);

it("sorts and deduplicates all target names without selecting a primary package", () => {
  const targets = [target("zod"), target("@example/library"), target("zod")];
  expect(skillDisplayTitle(targets)).toBe("@example/library + zod");
  expect(skillDisplayTitle([...targets].reverse())).toBe(
    "@example/library + zod",
  );
  expect(targets.map((entry) => entry.packageName)).toEqual([
    "zod",
    "@example/library",
    "zod",
  ]);
});

it("rejects empty target lists and empty or padded target names", () => {
  expect(() => skillDisplayTitle([])).toThrow("at least one target");
  expect(() => skillDisplayTitle([target("")])).toThrow("package names");
  expect(() => skillDisplayTitle([target(" react ")])).toThrow("package names");
});

it("accepts canonical titles shared by multiple majors", () => {
  const entry = {
    productId: "react",
    title: "react",
    targets: [target("react")],
  };
  const entries = [
    { ...entry, line: { major: 18, status: "active" } },
    { ...entry, line: { major: 19, status: "active" } },
  ];
  expect(() => validateSkillDisplayTitles(entries)).not.toThrow();
});

it("rejects branded titles and conflicting package identities across majors", () => {
  expect(() =>
    validateSkillDisplayTitles([
      { productId: "react", title: "React 19", targets: [target("react")] },
    ]),
  ).toThrow("Noncanonical public skill title");
  expect(() =>
    validateSkillDisplayTitles([
      { productId: "react", title: "react", targets: [target("react")] },
      {
        productId: "react",
        title: "react-dom",
        targets: [target("react-dom")],
      },
    ]),
  ).toThrow("differs across majors");
});

it("derives publication titles from targets while preserving source and delivery identities", () => {
  const root = mkdtempSync(join(tmpdir(), "pmcp-library-display-"));
  directories.push(root);
  const directory = join(root, "docs/skills/example-library/1");
  mkdirSync(directory, { recursive: true });
  const source = [
    "---",
    "name: example-library",
    'description: "Validate input with the public library API."',
    "---",
    "",
    "# Example library",
    "",
    "Use the public API at application boundaries.",
    "",
  ].join("\n");
  writeFileSync(join(directory, "SKILL.md"), source);
  writeFileSync(join(root, "LICENSE"), "Fixture license\n");
  writeFileSync(
    join(root, "docs/catalog.json"),
    JSON.stringify({
      revision: "display-before",
      publishedAt: "2026-10-10T00:00:00.000Z",
      entries: [],
    }),
  );
  const targets = [target("@example/library")];
  const delivery = {
    packageName: "@modootoday/pmcp-example-library",
    version: "1.0.0",
  };
  const prepared = preparePublication(
    root,
    {
      revision: "display-after",
      publishedAt: "2026-10-10T00:00:00.000Z",
      entries: [
        {
          productId: "example-library",
          major: 1,
          title: "A branded label 1.x",
          summary: "Validate application input.",
          targets,
          delivery,
        },
      ],
    },
    {
      entries: {
        "example-library/1": {
          verifiedOn: "2026-10-10",
          fixtures: [
            {
              targetPackage: "@example/library",
              version: "1.2.3",
              command: "node fixtures/example.mjs",
              exitCode: 0,
              checks: 1,
              skillSha256: sourceDigest(source),
            },
          ],
        },
      },
    },
  );
  const entry = prepared.catalog.entries[0]!;
  expect(entry.title).toBe("@example/library");
  expect(entry.productId).toBe("example-library");
  expect(entry.targets).toEqual(targets);
  expect(entry.delivery).toMatchObject(delivery);
  const archive = prepared.writes.find((write) =>
    write.path.endsWith("/package.tgz"),
  );
  expect(
    readArchive(archive!.bytes)
      .get("package/skills/example-library/SKILL.md")
      ?.toString(),
  ).toBe(source);
});
