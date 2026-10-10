import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { readCatalog } from "../src/catalog.js";
import { checkLibrarySkills } from "../scripts/library-skills/check.mjs";
import { renderGuide } from "../scripts/site/guides/render.mjs";
import {
  manualLibraryDescriptors,
  manualPageResources,
  readManualLibrarySkills,
} from "../scripts/library-skills/manual.mjs";

const directories: string[] = [];

it("renders explicit manual source downloads as public links", () => {
  for (const descriptor of manualLibraryDescriptors) {
    const route = `/${descriptor.path.slice("docs/".length)}`;
    expect(renderGuide(`[Download](${route})`)).toContain(`href="${route}"`);
  }
});

it("rejects unregistered manual downloads and private file paths", () => {
  for (const route of [
    "/skills/pydantic/2/package.tgz",
    "/skills/private/1/SKILL.md",
    "/skills/pydantic/2/../private.md",
  ]) {
    expect(() => renderGuide(`[Download](${route})`)).toThrow(
      "Unsupported guide link",
    );
  }
});
const catalog = {
  revision: "manual-fixture",
  publishedAt: "2026-10-10T00:00:00.000Z",
  entries: [],
};

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixtureRoot(installed = true) {
  const root = mkdtempSync(join(tmpdir(), "pmcp-manual-library-"));
  directories.push(root);
  mkdirSync(join(root, "docs/skills"), { recursive: true });
  writeFileSync(join(root, "docs/catalog.json"), JSON.stringify(catalog));
  if (!installed) return root;
  writeFileSync(join(root, "docs/manual-library-skills.md"), "Manual pilots\n");
  for (const descriptor of manualLibraryDescriptors) {
    const path = join(root, descriptor.path);
    const name = descriptor.path.split("/")[2];
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      `---\nname: ${name}\ndescription: Read the selected library instructions.\nmetadata:\n  ecosystem: ${descriptor.ecosystem}\n  target-identity: ${descriptor.library}\n  selected-version: "${descriptor.version}"\n  loading: manual\n---\n\n# Library task\nUse its public API.\n`,
    );
  }
  return root;
}

it("keeps minimal publication roots optional and reports unrelated authoring drafts", () => {
  const root = fixtureRoot(false);
  const directory = join(root, "docs/skills/unlisted-library/1");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "SKILL.md"),
    "---\nname: unlisted-library\ndescription: Unpublished instructions.\n---\nDraft\n",
  );
  expect(readManualLibrarySkills(root, catalog)).toEqual([]);
  expect(checkLibrarySkills(root)).toEqual({
    entries: 0,
    revision: "manual-fixture",
    drafts: ["unlisted-library/1"],
  });
});

it("loads explicitly copied pilots through the existing plain local collection path", () => {
  const root = fixtureRoot();
  const pilots = readManualLibrarySkills(root, catalog);
  const collection = join(root, "caller-collection");
  for (const pilot of pilots) {
    const destination = join(collection, "skills", pilot.name, "SKILL.md");
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, pilot.source);
  }
  const warnings: string[] = [];
  const loaded = readCatalog({
    roots: [],
    packages: [collection],
    onWarning: (warning) => warnings.push(warning.reason),
  });
  expect(existsSync(join(collection, "package.json"))).toBe(false);
  expect(warnings).toEqual([]);
  expect(loaded.map((entry) => entry.slug).sort()).toEqual([
    "google-uuid",
    "pydantic",
    "serde-json",
  ]);
  expect(loaded.every((entry) => entry.package === "caller-collection")).toBe(
    true,
  );
  expect(loaded.find((entry) => entry.slug === "pydantic")?.metadata).toEqual({
    ecosystem: "pypi",
    "target-identity": "pydantic",
    "selected-version": "2.13.4",
    loading: "manual",
  });
});

it("prepares only allowlisted raw Pages files and references without npm metadata or archives", () => {
  const root = fixtureRoot();
  const directory = join(root, "docs/skills/pydantic/2");
  mkdirSync(join(directory, "references"));
  writeFileSync(join(directory, "references/boundary.md"), "Strict boundary\n");
  writeFileSync(join(directory, "package.tgz"), "Not a registry archive\n");
  writeFileSync(join(directory, "private.txt"), "Must stay outside Pages\n");
  const draftDirectory = join(root, "docs/skills/unlisted-library/1");
  mkdirSync(draftDirectory, { recursive: true });
  writeFileSync(join(draftDirectory, "SKILL.md"), "Unlisted content\n");
  const before = readFileSync(join(root, "docs/catalog.json"));
  const resources = manualPageResources(readManualLibrarySkills(root, catalog));
  expect([...resources.keys()].sort()).toEqual([
    "skills/google-uuid/1/SKILL.md",
    "skills/pydantic/2/SKILL.md",
    "skills/pydantic/2/references/boundary.md",
    "skills/serde-json/1/SKILL.md",
  ]);
  expect(resources.get("skills/pydantic/2/SKILL.md")).toEqual(
    readFileSync(join(directory, "SKILL.md")),
  );
  expect(
    resources.get("skills/pydantic/2/references/boundary.md")?.toString(),
  ).toBe("Strict boundary\n");
  expect(checkLibrarySkills(root)).toMatchObject({
    entries: 0,
    manualPilots: 3,
    drafts: ["unlisted-library/1"],
  });
  expect(readFileSync(join(root, "docs/catalog.json"))).toEqual(before);
});

it("requires every selected source and rejects malformed YAML or descriptor drift", () => {
  const missingRoot = fixtureRoot();
  rmSync(join(missingRoot, "docs/skills/google-uuid/1/SKILL.md"));
  expect(() => readManualLibrarySkills(missingRoot, catalog)).toThrow();
  const malformedRoot = fixtureRoot();
  const malformedPath = join(malformedRoot, "docs/skills/pydantic/2/SKILL.md");
  writeFileSync(
    malformedPath,
    readFileSync(malformedPath, "utf8").replace(
      "Read the selected library instructions.",
      "Malformed description: nested value",
    ),
  );
  expect(() => readManualLibrarySkills(malformedRoot, catalog)).toThrow(
    "Invalid skill YAML",
  );
  const driftRoot = fixtureRoot();
  const driftPath = join(driftRoot, "docs/skills/pydantic/2/SKILL.md");
  writeFileSync(
    driftPath,
    readFileSync(driftPath, "utf8").replace('"2.13.4"', '"2.13.5"'),
  );
  expect(() => readManualLibrarySkills(driftRoot, catalog)).toThrow(
    "metadata differs",
  );
});

it("rejects source, reference and directory symlinks before publishing raw content", () => {
  const root = fixtureRoot();
  const sourcePath = join(root, "docs/skills/pydantic/2/SKILL.md");
  const outside = join(root, "outside.md");
  writeFileSync(outside, readFileSync(sourcePath));
  rmSync(sourcePath);
  symlinkSync(outside, sourcePath);
  expect(() => readManualLibrarySkills(root, catalog)).toThrow("regular file");
  rmSync(sourcePath);
  writeFileSync(sourcePath, readFileSync(outside));
  const references = join(root, "docs/skills/pydantic/2/references");
  mkdirSync(references);
  symlinkSync(outside, join(references, "escape.md"));
  expect(() => readManualLibrarySkills(root, catalog)).toThrow(
    "without symlinks",
  );
  rmSync(references, { recursive: true });
  const skillDirectory = join(root, "docs/skills/pydantic/2");
  const linkedDirectory = join(root, "linked-source");
  mkdirSync(linkedDirectory);
  writeFileSync(join(linkedDirectory, "SKILL.md"), readFileSync(outside));
  rmSync(skillDirectory, { recursive: true });
  symlinkSync(linkedDirectory, skillDirectory);
  expect(() => readManualLibrarySkills(root, catalog)).toThrow(
    "directories cannot contain symlinks",
  );
});

it("rejects managed npm product and target collisions instead of reclassifying identities", () => {
  const root = fixtureRoot();
  for (const entry of [
    { productId: "pydantic", targets: [{ packageName: "unrelated-library" }] },
    { productId: "unrelated-library", targets: [{ packageName: "pydantic" }] },
  ]) {
    expect(() => readManualLibrarySkills(root, { entries: [entry] })).toThrow(
      "collides with the npm catalog",
    );
  }
});
