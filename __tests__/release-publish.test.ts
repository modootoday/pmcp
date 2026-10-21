import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { parse } from "yaml";

const root = join(import.meta.dirname, "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  .version as string;
const platforms = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"];
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

// A release directory with the five tarballs and an npm that logs its calls; npm view
// answers for the names in onNpm.
function release(onNpm: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-release-"));
  dirs.push(dir);
  const names = [
    ...platforms.map((p) => `@modootoday/pmcp-${p}`),
    "@modootoday/pmcp",
  ];
  for (const name of names) {
    const stage = join(dir, "stage", name.replace("/", "-"), "package");
    mkdirSync(stage, { recursive: true });
    writeFileSync(
      join(stage, "package.json"),
      JSON.stringify({ name, version }),
    );
    mkdirSync(join(dir, "packed"), { recursive: true });
    const file = `${name.slice(1).replace("/", "-")}-${version}.tgz`;
    spawnSync("tar", [
      "-czf",
      join(dir, "packed", file),
      "-C",
      join(stage, ".."),
      "package",
    ]);
  }
  mkdirSync(join(dir, "bin"));
  writeFileSync(
    join(dir, "bin", "npm"),
    `#!/bin/sh\necho "$*" >> "${join(dir, "calls")}"\nif [ "$1" = view ]; then\n  for n in ${onNpm.join(" ")}; do [ "$2" = "$n@${version}" ] && echo ${version}; done\nfi\nexit 0\n`,
  );
  chmodSync(join(dir, "bin", "npm"), 0o755);
  const run = (script: string, args: string[], env: Record<string, string>) =>
    spawnSync("bash", [join(root, "scripts/release", script), ...args], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(dir, "bin")}:${process.env.PATH}`,
        GITHUB_OUTPUT: join(dir, "output"),
        GITHUB_STEP_SUMMARY: join(dir, "summary"),
        ...env,
      },
    });
  const publishes = () =>
    readFileSync(join(dir, "calls"), "utf8")
      .split("\n")
      .filter((line) => line.startsWith("publish "));
  const read = (name: string) => readFileSync(join(dir, name), "utf8");
  return { run, publishes, read };
}

// The 0.18.1 tag failed in a publish step no rehearsal had reached; every mode runs this one.
it("rehearses every package with npm publish --dry-run on ./ paths, platforms first", () => {
  const r = release([]);
  const out = r.run("publish.sh", ["./packed"], { MODE: "dry-run" });
  expect(out.status, out.stderr).toBe(0);
  const calls = r.publishes();
  expect(calls).toHaveLength(5);
  for (const call of calls) {
    expect(call).toMatch(
      /^publish \.\/packed\/modootoday-pmcp-.*\.tgz --access public --dry-run$/u,
    );
  }
  expect(calls.at(-1)).toContain(`modootoday-pmcp-${version}.tgz`);
  expect(r.read("output")).toContain("published=0");
});

it("publishes with provenance and skips what is already on npm, so a rerun is safe", () => {
  const r = release(["@modootoday/pmcp-linux-x64"]);
  const out = r.run("publish.sh", ["./packed"], { MODE: "publish" });
  expect(out.status, out.stderr).toBe(0);
  expect(out.stdout).toContain(
    `skip: @modootoday/pmcp-linux-x64@${version} is already on npm`,
  );
  const calls = r.publishes();
  expect(calls).toHaveLength(4);
  for (const call of calls)
    expect(call).toMatch(/ --access public --provenance$/u);
  expect(calls.at(-1)).toContain(`modootoday-pmcp-${version}.tgz`);
  expect(r.read("output")).toContain("published=4");
});

it("refuses a directory npm would read as a GitHub shorthand", () => {
  const r = release([]);
  const out = r.run("publish.sh", ["packed"], { MODE: "dry-run" });
  expect(out.status).toBe(2);
  expect(out.stderr).toContain("must start with ./ or /");
});

it("reports which packages reached npm and how to recover", () => {
  const r = release([
    "@modootoday/pmcp-linux-x64",
    "@modootoday/pmcp-darwin-arm64",
  ]);
  const out = r.run("report.sh", [], {
    GITHUB_RUN_ID: "123",
    RELEASE_TAG: `v${version}`,
  });
  expect(out.status, out.stderr).toBe(0);
  const summary = r.read("summary");
  expect(summary).toContain(
    `| \`@modootoday/pmcp-linux-x64@${version}\` | yes |`,
  );
  expect(summary).toContain(
    `| \`@modootoday/pmcp-linux-arm64@${version}\` | no |`,
  );
  expect(summary).toContain(`| \`@modootoday/pmcp@${version}\` | no |`);
  expect(summary).toContain("gh run rerun 123 --failed");
  expect(summary).toContain("never move or reuse the tag");
});

// The 0.18.2 rehearsal deleted its draft and then failed: a draft has no tag ref, so
// gh release delete --cleanup-tag answered 422. The cleanup deletes the draft only.
it("removes a rehearsal draft without asking for a tag that never existed", () => {
  const workflow = parse(
    readFileSync(join(root, ".github/workflows/release.yml"), "utf8"),
  ) as { jobs: Record<string, { steps: { name?: string; run?: string }[] }> };
  const step = workflow.jobs.publish!.steps.find(
    (entry) => entry.name === "Remove the dry-run draft",
  );
  expect(step?.run).toContain("draft.sh delete");
  expect(step?.run).not.toContain("--cleanup-tag");
});

// The draft carries the generated notes from the start; publishing must not replace them, and a
// rehearsal shows them (with non-conventional subjects) before anything is tagged.
it("writes the generated notes into the draft and the rehearsal summary", () => {
  const workflow = parse(
    readFileSync(join(root, ".github/workflows/release.yml"), "utf8"),
  ) as {
    jobs: Record<
      string,
      {
        steps: {
          name?: string;
          run?: string;
          with?: Record<string, unknown>;
        }[];
      }
    >;
  };
  const draft = workflow.jobs.draft!.steps;
  expect(draft[0]!.with?.["fetch-depth"]).toBe(0);
  const notes = draft.find((step) => step.name === "Release notes")?.run ?? "";
  expect(notes).toContain("scripts/release/notes.mjs");
  expect(notes).toContain('--summary >> "$GITHUB_STEP_SUMMARY"');
  expect(draft.map((step) => step.run ?? "").join("\n")).toMatch(
    /draft\.sh create .* notes\.md/u,
  );
  const mark = workflow.jobs.publish!.steps.find(
    (step) => step.name === "Mark the release published",
  );
  expect(mark?.run).not.toContain("--notes");
});
