import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { parse } from "yaml";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

// The release workflow's run scripts, the scripts it runs and RELEASING.md's shell blocks.
function scripts(): { source: string; text: string }[] {
  const workflow = parse(read(".github/workflows/release.yml")) as {
    jobs: Record<string, { steps?: { run?: string }[] }>;
  };
  const runs = Object.values(workflow.jobs).flatMap((job) =>
    (job.steps ?? []).flatMap((step) => (step.run ? [step.run] : [])),
  );
  const blocks = [
    ...read(".github/RELEASING.md").matchAll(/```sh\n([\s\S]*?)```/gu),
  ];
  const shells = ["publish.sh", "report.sh"].map((name) => ({
    source: name,
    text: read(`scripts/release/${name}`),
  }));
  return [
    ...runs.map((text) => ({ source: "release.yml", text })),
    ...shells,
    ...blocks.map((block) => ({ source: "RELEASING.md", text: block[1]! })),
  ];
}

const local = (word: string) =>
  /^"?(\.\/|\/|\$)/u.test(word) || word.startsWith('"$');

// 0.18.1's tag run failed in publish: npm read "packed/<name>.tgz" as a GitHub owner/repo
// shorthand. A path npm receives must start with ./ or /, and the dry-run never publishes.
it("passes npm publish and npm pack only explicit local paths", () => {
  const bad: string[] = [];
  for (const { source, text } of scripts()) {
    for (const line of text.split("\n")) {
      if (/^\s*#/u.test(line)) continue;
      const npm = /\bnpm (publish|pack)\b(.*?)(;|$)/u.exec(line);
      if (npm) {
        const words = npm[2]!.trim().split(/\s+/u).filter(Boolean);
        for (let i = 0; i < words.length; i++) {
          if (words[i]!.startsWith("--")) {
            if (words[i] === "--pack-destination" && !local(words[i + 1]!))
              bad.push(`${source}: ${line.trim()}`);
            if (!words[i]!.includes("=") && words[i] !== "--provenance") i++;
            continue;
          }
          if (!local(words[i]!)) bad.push(`${source}: ${line.trim()}`);
        }
      }
      // Values a loop feeds to npm, or to the workflow's publish wrapper.
      const loop =
        /\bfor \w+ in (.+?); do .*\b(npm (publish|pack)|publish) /u.exec(line);
      if (loop)
        for (const word of loop[1]!.trim().split(/\s+/u))
          if (!local(word)) bad.push(`${source}: ${line.trim()}`);
      const call = /^\s*publish (\S+)/u.exec(line);
      if (call && !local(call[1]!)) bad.push(`${source}: ${line.trim()}`);
    }
  }
  expect(bad).toEqual([]);
});
