// Release notes from the commits since the previous published release, grouped by their
// Conventional Commits type. Each line links its commit, so every note is traceable.
// Usage: node scripts/release/notes.mjs --to <ref> --published v1,v2 [--repo owner/repo] [--summary]
import { execFileSync } from "node:child_process";

const GROUPS = [
  ["breaking", "Breaking changes"],
  ["feat", "Features"],
  ["fix", "Fixes"],
  ["docs", "Documentation"],
  ["other", "Other changes"],
];
const SUBJECT = /^(\w+)(?:\(([^)]*)\))?(!)?: (.+)$/u;
const FOOTER = /^BREAKING[ -]CHANGE: ([\s\S]+?)(?:\n\n|$)/mu;

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8" });

// The newest v* tag below the release that has a published release; a tag pushed but never
// published (its run failed) is skipped, so its commits stay in the next notes.
export function previousTag(to, published, cwd) {
  const tags = git(
    ["tag", "--list", "v*", "--merged", to, "--sort=-v:refname"],
    cwd,
  )
    .split("\n")
    .filter(Boolean);
  const target = git(["rev-parse", `${to}^{commit}`], cwd).trim();
  return tags.find(
    (tag) =>
      published.includes(tag) &&
      git(["rev-parse", `${tag}^{commit}`], cwd).trim() !== target,
  );
}

export function commits(from, to, cwd) {
  const range = from ? `${from}..${to}` : to;
  return git(["log", "--no-merges", "--format=%H%x1f%s%x1f%b%x1e", range], cwd)
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, subject, body] = record.split("\x1f");
      const parts = SUBJECT.exec(subject);
      const footer = FOOTER.exec(body ?? "")?.[1]?.trim();
      return {
        sha,
        subject,
        type: parts?.[1] ?? null,
        scope: parts?.[2] ?? null,
        text: parts?.[4] ?? subject,
        breaking: Boolean(parts?.[3] || footer),
        footer,
        conventional: Boolean(parts),
      };
    });
}

function group(commit) {
  if (commit.breaking) return "breaking";
  if (commit.type === "feat" || commit.type === "fix" || commit.type === "docs")
    return commit.type;
  return "other";
}

export function notes({ to, published, repo, cwd, summary = false }) {
  const from = previousTag(to, published, cwd);
  const list = commits(from, to, cwd);
  const url = `https://github.com/${repo}`;
  const line = (commit) => {
    const label = commit.scope
      ? `${commit.scope}: ${commit.text}`
      : commit.text;
    const head = `- ${label} ([${commit.sha.slice(0, 7)}](${url}/commit/${commit.sha}))`;
    return commit.footer
      ? `${head}\n  ${commit.footer.replace(/\n/gu, "\n  ")}`
      : head;
  };
  const out = [];
  for (const [key, title] of GROUPS) {
    const entries = list.filter((commit) => group(commit) === key);
    if (entries.length)
      out.push(`### ${title}\n\n${entries.map(line).join("\n")}`);
  }
  if (!out.length) out.push("No changes since the previous release.");
  out.push(
    `[Upgrading](https://pmcp.build/upgrading/) · [Known issues](https://pmcp.build/known-issues/)` +
      (from ? ` · [All changes](${url}/compare/${from}...${to})` : ""),
  );
  const odd = list.filter((commit) => !commit.conventional);
  if (summary && odd.length)
    out.push(
      `### Not conventional\n\nThese subjects do not follow \`type(scope): summary\`; reword them before tagging if they can still change.\n\n${odd.map((commit) => `- ${commit.subject} (${commit.sha.slice(0, 7)})`).join("\n")}`,
    );
  return { from, text: `${out.join("\n\n")}\n` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : fallback;
  };
  const to = option("--to");
  if (!to) throw new Error("notes.mjs: --to <ref> is required");
  const { text } = notes({
    to,
    published: (option("--published", "") ?? "").split(",").filter(Boolean),
    repo: option("--repo", process.env.GITHUB_REPOSITORY ?? "modootoday/pmcp"),
    cwd: process.cwd(),
    summary: args.includes("--summary"),
  });
  process.stdout.write(text);
}
