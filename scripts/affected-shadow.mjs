#!/usr/bin/env node
// Compares `pmcp git affected --tests-only` with a project's own selector over recent
// first-parent commits, each against its parent. It checks commits out in --checkout, so
// pass a disposable clone (git clone --shared --no-checkout <repo> <dir>), never a work tree.
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    checkout: { type: "string" },
    tip: { type: "string", default: "HEAD" },
    commits: { type: "string", default: "50" },
    config: { type: "string" },
    pmcp: { type: "string", default: "pmcp" },
    project: { type: "string" },
    out: { type: "string" },
  },
});
if (!values.checkout || !values.config || !values.project) {
  process.stderr.write(
    "usage: affected-shadow.mjs --checkout <scratch clone> --config <pmcp.toml> --project '<argv with {base}>' [--tip <rev>] [--commits N] [--pmcp '<argv>'] [--out <file.json>]\n",
  );
  process.exit(2);
}

const git = (...args) =>
  execFileSync("git", ["-C", values.checkout, ...args], {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  }).trim();

function lines(argv, base) {
  const [bin, ...rest] = argv.map((part) => part.replaceAll("{base}", base));
  const run = spawnSync(bin, rest, {
    cwd: values.checkout,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  return {
    status: run.status,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
  };
}

function set(text) {
  return [
    ...new Set(
      text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    ),
  ].sort();
}

const words = (text) => text.split(" ").filter(Boolean);
const commits = git(
  "rev-list",
  "--first-parent",
  `--max-count=${values.commits}`,
  values.tip,
).split("\n");
const rows = [];
for (const commit of commits) {
  const parent = `${commit}^`;
  git("checkout", "-q", "--force", "--detach", commit);
  const project = lines(words(values.project), parent);
  const ours = lines(
    [
      ...words(values.pmcp),
      "git",
      "affected",
      "--base",
      parent,
      "--tests-only",
      "--json",
      "--config",
      values.config,
    ],
    parent,
  );
  let pmcp;
  try {
    const parsed = JSON.parse(ours.stdout);
    // 0.23 wraps --json output in {schema, ok, data, errors}; an older --pmcp prints it bare.
    const enveloped = "data" in parsed && "errors" in parsed;
    if (enveloped && !parsed.data) throw new Error("no result");
    pmcp = enveloped ? parsed.data : parsed;
  } catch {
    pmcp = {
      all: true,
      reason: `pmcp failed: ${ours.stderr.trim().split("\n").pop()}`,
      changed: [],
      unmapped: [],
    };
  }
  const theirs = set(project.stdout);
  const theirAll = theirs.includes("ALL");
  const mine = pmcp.all ? ["ALL"] : pmcp.changed;
  const onlyProject =
    theirAll || pmcp.all ? [] : theirs.filter((d) => !mine.includes(d));
  const onlyPmcp =
    theirAll || pmcp.all ? [] : mine.filter((d) => !theirs.includes(d));
  const agree =
    theirAll === pmcp.all && onlyProject.length === 0 && onlyPmcp.length === 0;
  rows.push({
    commit: commit.slice(0, 10),
    subject: git("log", "-1", "--format=%s", commit).slice(0, 80),
    agree,
    project: theirAll ? "ALL" : theirs,
    pmcp: pmcp.all ? `ALL (${pmcp.reason})` : mine,
    onlyProject,
    onlyPmcp,
    unmapped: pmcp.unmapped,
  });
  process.stderr.write(
    `${agree ? "=" : "!"} ${commit.slice(0, 10)} project ${theirAll ? "ALL" : theirs.length} pmcp ${pmcp.all ? "ALL" : mine.length}\n`,
  );
}
const summary = {
  commits: rows.length,
  agree: rows.filter((r) => r.agree).length,
  bothAll: rows.filter(
    (r) => r.project === "ALL" && String(r.pmcp).startsWith("ALL"),
  ).length,
  projectAllOnly: rows.filter(
    (r) => r.project === "ALL" && !String(r.pmcp).startsWith("ALL"),
  ).length,
  pmcpAllOnly: rows.filter(
    (r) => r.project !== "ALL" && String(r.pmcp).startsWith("ALL"),
  ).length,
  listsDiffer: rows.filter(
    (r) => !r.agree && r.project !== "ALL" && !String(r.pmcp).startsWith("ALL"),
  ).length,
};
const report = { summary, rows };
if (values.out)
  writeFileSync(values.out, JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(summary) + "\n");
