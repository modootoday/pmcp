import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import {
  createArchive,
  integrity,
  readArchive,
} from "../scripts/library-skills/archive.mjs";
import { checkLibrarySkills } from "../scripts/library-skills/check.mjs";
import {
  preparePublication,
  writePublication,
} from "../scripts/library-skills/publication.mjs";
import {
  contentDigest,
  parseSkill,
  readSkillFiles,
  sourceDigest,
} from "../scripts/library-skills/source.mjs";

const directories: string[] = [];
const source =
  '---\nname: example-library\ndescription: "Validate example-library values at application boundaries."\n---\n\n# Example library\n\nUse its public API.\n';

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixtureRoot(legacySource = source) {
  const root = mkdtempSync(join(tmpdir(), "pmcp-library-publication-"));
  directories.push(root);
  const directory = join(root, "docs/skills/example-library/1");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(root, "LICENSE"), "Fixture license\n");
  writeFileSync(join(directory, "SKILL.md"), legacySource);
  const manifest = {
    name: "@modootoday/pmcp-example-library",
    version: "1.0.0",
    files: ["skills", "LICENSE"],
    license: "SEE LICENSE IN LICENSE",
  };
  const archive = createArchive(
    new Map([
      ["package/package.json", Buffer.from(JSON.stringify(manifest))],
      ["package/LICENSE", Buffer.from("Fixture license\n")],
      ["package/skills/example-library/SKILL.md", Buffer.from(legacySource)],
    ]),
  );
  writeFileSync(join(directory, "package.tgz"), archive);
  const entry = {
    productId: "example-library",
    title: "Example library",
    summary: "Validate application input",
    targets: [
      {
        packageName: "example-library",
        range: "^1.0.0",
        verifiedVersions: ["1.2.3"],
      },
    ],
    delivery: {
      packageName: manifest.name,
      version: manifest.version,
      integrity: integrity(archive),
    },
    skillRevision: 1,
    contentDigest: contentDigest("example-library", legacySource),
    evidence: { verifiedOn: "2026-09-07", examplesExecuted: 2 },
    line: { major: 1, status: "active" },
  };
  const catalog = {
    revision: "fixture-before",
    publishedAt: "2026-09-07T00:00:00.000Z",
    entries: [entry],
  };
  writeFileSync(join(root, "docs/catalog.json"), JSON.stringify(catalog));
  const metadata = {
    revision: "fixture-after",
    publishedAt: "2026-10-10T00:00:00.000Z",
    entries: [
      {
        productId: entry.productId,
        major: 1,
        title: entry.title,
        summary: entry.summary,
        targets: entry.targets,
        delivery: { packageName: manifest.name, version: "1.0.1" },
      },
    ],
  };
  const evidence = {
    entries: {
      "example-library/1": {
        verifiedOn: "2026-10-10",
        fixtures: [
          {
            targetPackage: "example-library",
            version: "1.2.3",
            command: "node fixtures/validate.mjs",
            exitCode: 0,
            checks: 3,
            skillSha256: sourceDigest(source),
          },
        ],
      },
    },
  };
  return { root, directory, archive, catalog, metadata, evidence };
}

it("builds deterministic content-only archives with licensed references and unchanged skill framing", () => {
  const fixture = fixtureRoot();
  mkdirSync(join(fixture.directory, "references"));
  writeFileSync(
    join(fixture.directory, "references/lifecycle.md"),
    "# Lifecycle\nClose resources.\n",
  );
  const first = preparePublication(
    fixture.root,
    fixture.metadata,
    fixture.evidence,
  );
  const second = preparePublication(
    fixture.root,
    fixture.metadata,
    fixture.evidence,
  );
  const archive = first.writes.find((write) =>
    write.path.endsWith("/package.tgz"),
  );
  const repeated = second.writes.find((write) =>
    write.path.endsWith("/package.tgz"),
  );
  expect(archive?.bytes.equals(repeated!.bytes)).toBe(true);
  const members = readArchive(archive!.bytes);
  expect(
    members
      .get("package/skills/example-library/references/lifecycle.md")
      ?.toString(),
  ).toContain("Close resources");
  expect(members.get("package/LICENSE")?.toString()).toBe("Fixture license\n");
  const manifest = JSON.parse(members.get("package/package.json")!.toString());
  expect(manifest.scripts).toBeUndefined();
  expect(manifest.dependencies).toBeUndefined();
  expect(first.catalog.entries[0]!.contentDigest).toBe(
    fixture.catalog.entries[0]!.contentDigest,
  );
  expect(first.catalog.entries[0]!.delivery.integrity).not.toBe(
    fixture.catalog.entries[0]!.delivery.integrity,
  );
  expect(readFileSync(join(fixture.directory, "package.tgz"))).toEqual(
    fixture.archive,
  );
  expect(readFileSync(join(fixture.root, "docs/catalog.json"), "utf8")).toBe(
    JSON.stringify(fixture.catalog),
  );
});

it("preserves frozen lines and increments revisions across a product's majors", () => {
  const fixture = fixtureRoot();
  const old = structuredClone(fixture.catalog.entries[0]!);
  old.line = { major: 0, status: "frozen" };
  old.skillRevision = 8;
  old.delivery.version = "0.1.0";
  fixture.catalog.entries.push(old);
  writeFileSync(
    join(fixture.root, "docs/catalog.json"),
    JSON.stringify(fixture.catalog),
  );
  const prepared = preparePublication(
    fixture.root,
    fixture.metadata,
    fixture.evidence,
  );
  expect(prepared.catalog.entries[0]!.skillRevision).toBe(9);
  expect(prepared.catalog.entries[1]).toEqual(old);
});

it("writes immutable delivery snapshots and validates the resulting catalog without mutation", () => {
  const fixture = fixtureRoot();
  const prepared = preparePublication(
    fixture.root,
    fixture.metadata,
    fixture.evidence,
  );
  writePublication(prepared);
  expect(readFileSync(join(fixture.directory, "releases/1.0.0.tgz"))).toEqual(
    fixture.archive,
  );
  expect(readFileSync(join(fixture.directory, "releases/1.0.1.tgz"))).toEqual(
    readFileSync(join(fixture.directory, "package.tgz")),
  );
  const before = readFileSync(join(fixture.root, "docs/catalog.json"));
  expect(checkLibrarySkills(fixture.root)).toEqual({
    entries: 1,
    revision: "fixture-after",
  });
  expect(readFileSync(join(fixture.root, "docs/catalog.json"))).toEqual(before);
});

it("rejects changed content at an existing delivery version before any write", () => {
  const fixture = fixtureRoot();
  fixture.metadata.entries[0]!.delivery.version = "1.0.0";
  expect(() =>
    preparePublication(fixture.root, fixture.metadata, fixture.evidence),
  ).toThrow("newer delivery version");
  expect(readFileSync(join(fixture.directory, "package.tgz"))).toEqual(
    fixture.archive,
  );
});

it("rejects failed, stale and incomplete execution evidence", () => {
  const fixture = fixtureRoot();
  const evidence = fixture.evidence.entries["example-library/1"];
  evidence.fixtures[0]!.exitCode = 1;
  expect(() =>
    preparePublication(fixture.root, fixture.metadata, fixture.evidence),
  ).toThrow("successful executed checks");
  evidence.fixtures[0]!.exitCode = 0;
  evidence.fixtures[0]!.skillSha256 = "0".repeat(64);
  expect(() =>
    preparePublication(fixture.root, fixture.metadata, fixture.evidence),
  ).toThrow("successful executed checks");
  evidence.fixtures[0]!.skillSha256 = sourceDigest(source);
  fixture.metadata.entries[0]!.targets[0]!.verifiedVersions.push("1.2.4");
  expect(() =>
    preparePublication(fixture.root, fixture.metadata, fixture.evidence),
  ).toThrow("no executed fixture evidence");
});

it("rejects rewritten delivery snapshots even when selected catalog version is new", () => {
  const fixture = fixtureRoot();
  mkdirSync(join(fixture.directory, "releases"));
  writeFileSync(join(fixture.directory, "releases/1.0.1.tgz"), "changed");
  expect(() =>
    preparePublication(fixture.root, fixture.metadata, fixture.evidence),
  ).toThrow("immutable");
});

it("retains historical evidence when only malformed YAML quoting is repaired", () => {
  const malformed = source.replace(
    '"Validate example-library values at application boundaries."',
    "Validate application input: use its public API.",
  );
  const fixture = fixtureRoot(malformed);
  const repaired = malformed.replace(
    "description: Validate application input: use its public API.",
    'description: "Validate application input: use its public API."',
  );
  writeFileSync(join(fixture.directory, "SKILL.md"), repaired);
  const metadata = {
    ...fixture.metadata,
    entries: [{ ...fixture.metadata.entries[0]!, repackageMetadataOnly: true }],
  };
  const prepared = preparePublication(fixture.root, metadata);
  expect(prepared.catalog.entries[0]!.evidence).toEqual(
    fixture.catalog.entries[0]!.evidence,
  );
  expect(prepared.catalog.entries[0]!.targets).toEqual(
    fixture.catalog.entries[0]!.targets,
  );
  expect(prepared.catalog.entries[0]!.delivery.version).toBe("1.0.1");
  writeFileSync(
    join(fixture.directory, "SKILL.md"),
    `${repaired}\nChanged instructions.\n`,
  );
  expect(() => preparePublication(fixture.root, metadata)).toThrow(
    "cannot change skill semantics or body",
  );
});

it("rejects source and reference symlinks without following their content", () => {
  const fixture = fixtureRoot();
  mkdirSync(join(fixture.directory, "references"));
  symlinkSync(
    join(fixture.root, "LICENSE"),
    join(fixture.directory, "references/escape.md"),
  );
  expect(() => readSkillFiles(fixture.directory)).toThrow("without symlinks");
  rmSync(join(fixture.directory, "references"), { recursive: true });
  rmSync(join(fixture.directory, "SKILL.md"));
  symlinkSync(
    join(fixture.root, "LICENSE"),
    join(fixture.directory, "SKILL.md"),
  );
  expect(() => readSkillFiles(fixture.directory)).toThrow("regular file");
});

it("rejects unsafe route and tar members", () => {
  const fixture = fixtureRoot();
  fixture.metadata.entries[0]!.productId = "../escape";
  expect(() =>
    preparePublication(fixture.root, fixture.metadata, fixture.evidence),
  ).toThrow("Invalid public skill route");
  expect(() =>
    createArchive(new Map([["package/../escape", Buffer.from("x")]])),
  ).toThrow("Unsafe archive path");
});

it("rejects strict YAML errors, duplicate fields and invalid Agent Skills names", () => {
  expect(() =>
    parseSkill(
      source.replace(
        '"Validate example-library values at application boundaries."',
        "Invalid YAML: nested",
      ),
    ),
  ).toThrow("Invalid skill YAML");
  expect(() =>
    parseSkill(
      source.replace(
        "name: example-library",
        "name: example-library\nname: repeated",
      ),
    ),
  ).toThrow("Invalid skill YAML");
  expect(() =>
    parseSkill(
      source.replace("name: example-library", "name: Example_Library"),
    ),
  ).toThrow("Invalid skill name");
});

it("detects archive integrity and reference drift during read-only verification", () => {
  const fixture = fixtureRoot();
  writeFileSync(
    join(fixture.directory, "package.tgz"),
    Buffer.concat([fixture.archive, Buffer.from("unexpected")]),
  );
  expect(() => checkLibrarySkills(fixture.root)).toThrow(
    "Archive integrity mismatch",
  );
  writeFileSync(join(fixture.directory, "package.tgz"), fixture.archive);
  mkdirSync(join(fixture.directory, "references"));
  writeFileSync(
    join(fixture.directory, "references/new.md"),
    "New reference\n",
  );
  expect(() => checkLibrarySkills(fixture.root)).toThrow(
    "Archive reference differs from source",
  );
});

it("requires explicit topic placement before publishing a newly selected target", () => {
  const fixture = fixtureRoot();
  const topicPath = join(fixture.root, "docs/topics.json");
  writeFileSync(
    topicPath,
    JSON.stringify({
      groups: [{ label: "Validation", packages: ["example-library"] }],
      ungrouped: [],
    }),
  );
  fixture.metadata.entries[0]!.targets[0]!.packageName = "second-library";
  fixture.evidence.entries["example-library/1"].fixtures[0]!.targetPackage =
    "second-library";
  const catalogBefore = readFileSync(join(fixture.root, "docs/catalog.json"));
  expect(() =>
    preparePublication(fixture.root, fixture.metadata, fixture.evidence),
  ).toThrow("Catalog target has no topic placement: second-library");
  expect(readFileSync(join(fixture.root, "docs/catalog.json"))).toEqual(
    catalogBefore,
  );
  expect(readFileSync(join(fixture.directory, "package.tgz"))).toEqual(
    fixture.archive,
  );
  writeFileSync(
    topicPath,
    JSON.stringify({
      groups: [
        {
          label: "Validation",
          packages: ["example-library", "second-library"],
        },
      ],
      ungrouped: [],
    }),
  );
  writePublication(
    preparePublication(fixture.root, fixture.metadata, fixture.evidence),
  );
  expect(checkLibrarySkills(fixture.root).entries).toBe(1);
});

it("rejects duplicate placements across grouped and ungrouped topics without mutation", () => {
  const fixture = fixtureRoot();
  const topicPath = join(fixture.root, "docs/topics.json");
  const topics = JSON.stringify({
    groups: [{ label: "Validation", packages: ["example-library"] }],
    ungrouped: ["example-library"],
  });
  writeFileSync(topicPath, topics);
  expect(() => checkLibrarySkills(fixture.root)).toThrow(
    "Duplicate topic placement: example-library",
  );
  expect(() =>
    preparePublication(fixture.root, fixture.metadata, fixture.evidence),
  ).toThrow("Duplicate topic placement: example-library");
  expect(readFileSync(topicPath, "utf8")).toBe(topics);
});

it("rejects malformed topic arrays and unnamed groups before preparing publication", () => {
  const fixture = fixtureRoot();
  const topicPath = join(fixture.root, "docs/topics.json");
  for (const invalid of [
    { groups: null, ungrouped: [] },
    { groups: [], ungrouped: "example-library" },
    { groups: [{ label: "", packages: ["example-library"] }], ungrouped: [] },
    { groups: [{ label: "Validation", packages: [null] }], ungrouped: [] },
  ]) {
    writeFileSync(topicPath, JSON.stringify(invalid));
    expect(() =>
      preparePublication(fixture.root, fixture.metadata, fixture.evidence),
    ).toThrow(/Topic/iu);
  }
});
