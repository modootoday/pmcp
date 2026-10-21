import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
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
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

// A gh that logs its calls and answers like the API: FOUND is the release the listing returns
// ("<id> <draft>"), ASSETS the names already on release 42, GONE makes every read by id fail.
const fakeGh = (dir: string) => `#!/bin/sh
echo "$*" >> "${join(dir, "calls")}"
for arg in "$@"; do case "$arg" in body=@*) cat "\${arg#body=@}" > "${join(dir, "body")}" ;; esac; done
case "$*" in
  *"--jq .id")
    [ -n "$GONE" ] && { echo "HTTP 404: Not Found" >&2; exit 1; }
    echo 42 ;;
  "api repos/acme/tool/releases --paginate"*) [ -n "$FOUND" ] && echo "$FOUND" ;;
  "api --method POST repos/acme/tool/releases "*) echo 42 ;;
  *"--jq .body") printf "%s\\n\\n%s\\n" "> In use by release run https://github.com/acme/tool/actions/runs/7, which publishes or deletes this draft." "### Fixes" ;;
  *"--jq .upload_url") echo 'https://uploads.github.com/repos/acme/tool/releases/42/assets{?name,label}' ;;
  *endswith*) printf '7 x86_64-apple-darwin.tar.gz\\n8 aarch64-apple-darwin.tar.gz\\n' ;;
  *"/assets --paginate"*) for name in $ASSETS; do echo "$name"; done ;;
  *"releases/assets/"*) echo archive ;;
esac
exit 0
`;

function draft(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pmcp-draft-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "gh"), fakeGh(dir));
  chmodSync(join(dir, "bin", "gh"), 0o755);
  writeFileSync(join(dir, "notes.md"), "### Fixes\n");
  writeFileSync(join(dir, "output"), "");
  const run = (...args: string[]) =>
    spawnSync("bash", [join(root, "scripts/release/draft.sh"), ...args], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(dir, "bin")}:${process.env.PATH}`,
        GH_REPO: "acme/tool",
        GITHUB_SHA: "abc123",
        GITHUB_OUTPUT: join(dir, "output"),
        RELEASE_ID: "42",
        RELEASE_TAG: "v1.2.3",
        GITHUB_RUN_ID: "7",
        GITHUB_SERVER_URL: "https://github.com",
        FOUND: "",
        ASSETS: "",
        GONE: "",
        ...env,
      },
    });
  const calls = () =>
    existsSync(join(dir, "calls"))
      ? readFileSync(join(dir, "calls"), "utf8").split("\n").filter(Boolean)
      : [];
  const read = (name: string) => readFileSync(join(dir, name), "utf8");
  return { dir, run, calls, read };
}

// The 0.18.2 follow-up rehearsal created its draft and then could not find it by tag name;
// every step after the create uses the id instead.
it("creates the draft with the notes and outputs its id after reading it back", () => {
  const d = draft();
  const out = d.run("create", "dry-run-1", "notes.md");
  expect(out.status, out.stderr).toBe(0);
  const post = d.calls().find((call) => call.includes("--method POST"));
  expect(post).toContain("tag_name=dry-run-1");
  expect(post).toContain("target_commitish=abc123");
  expect(post).toContain("draft=true");
  expect(post).toContain(
    "name=dry-run-1 (release run 7 in progress, do not delete)",
  );
  expect(d.read("body")).toBe(
    "> In use by release run https://github.com/acme/tool/actions/runs/7, which publishes or deletes this draft. Do not edit or delete it by hand.\n\n### Fixes\n",
  );
  expect(d.calls()).toContain("api repos/acme/tool/releases/42 --jq .id");
  expect(d.read("output")).toBe("id=42\n");
});

it("reuses an existing release: a draft gets the current notes, a published one is left alone", () => {
  const drafted = draft({ FOUND: "17 true" });
  expect(drafted.run("create", "v1.2.3", "notes.md").status).toBe(0);
  expect(drafted.calls().some((call) => call.includes("--method POST"))).toBe(
    false,
  );
  expect(drafted.calls()).toContainEqual(
    expect.stringMatching(
      /^api --method PATCH repos\/acme\/tool\/releases\/17 -f name=v1\.2\.3 \(release run 7 in progress, do not delete\) -F body=@\S+ --jq \.id$/u,
    ),
  );
  expect(drafted.read("output")).toBe("id=17\n");

  const published = draft({ FOUND: "17 false" });
  expect(published.run("create", "v1.2.3", "notes.md").status).toBe(0);
  expect(published.calls().some((call) => call.includes("PATCH"))).toBe(false);
  expect(published.read("output")).toBe("id=17\n");
});

it("fails in the draft job, without an id, when the release cannot be read back", () => {
  const d = draft({ GONE: "1" });
  const out = d.run("create", "dry-run-1", "notes.md");
  expect(out.status).not.toBe(0);
  expect(d.read("output")).toBe("");
});

it("uploads to the release by id and skips an archive that is already there", () => {
  const fresh = draft();
  writeFileSync(join(fresh.dir, "x86_64-apple-darwin.tar.gz"), "bytes");
  const out = fresh.run("upload", "x86_64-apple-darwin.tar.gz");
  expect(out.status, out.stderr).toBe(0);
  expect(fresh.calls().at(-1)).toBe(
    "api --method POST https://uploads.github.com/repos/acme/tool/releases/42/assets?name=x86_64-apple-darwin.tar.gz -H Content-Type: application/gzip --input x86_64-apple-darwin.tar.gz --jq .name",
  );

  const kept = draft({ ASSETS: "x86_64-apple-darwin.tar.gz" });
  const skip = kept.run("upload", "x86_64-apple-darwin.tar.gz");
  expect(skip.status, skip.stderr).toBe(0);
  expect(skip.stdout).toContain("skip: x86_64-apple-darwin.tar.gz");
  expect(kept.calls().some((call) => call.includes("--method POST"))).toBe(
    false,
  );
});

it("downloads, publishes and deletes the release by id", () => {
  const d = draft();
  expect(d.run("download", "bins").status).toBe(0);
  expect(d.read("bins/aarch64-apple-darwin.tar.gz")).toBe("archive\n");
  expect(d.read("bins/x86_64-apple-darwin.tar.gz")).toBe("archive\n");
  expect(d.run("publish").status).toBe(0);
  // The published release keeps the notes under its plain tag, without the in-use line.
  expect(d.read("body")).toBe("### Fixes\n");
  expect(d.run("delete").status).toBe(0);
  expect(d.calls().filter((call) => call.includes("--method"))).toEqual([
    expect.stringMatching(
      /^api --method PATCH repos\/acme\/tool\/releases\/42 -f name=v1\.2\.3 -F draft=false -F body=@\S+ --jq \.html_url$/u,
    ),
    "api --method DELETE repos/acme/tool/releases/42",
  ]);
  for (const call of d.calls()) expect(call).not.toMatch(/^release /u);
});

it("says the release was deleted outside the run when a later job cannot find it", () => {
  for (const command of [
    ["upload", "x86_64-apple-darwin.tar.gz"],
    ["download", "bins"],
    ["publish"],
    ["delete"],
  ]) {
    const d = draft({ GONE: "1" });
    const out = d.run(...command);
    expect(out.status).toBe(1);
    expect(out.stderr).toContain(
      "Release 42 is gone: it was deleted outside this run",
    );
    expect(out.stderr).toContain("by hand on the Releases page");
    expect(out.stderr).toContain("audit log");
    expect(d.calls()).toEqual(["api repos/acme/tool/releases/42 --jq .id"]);
  }
});

it("leaves no release lookup by tag name in the workflow", () => {
  const source = readFileSync(
    join(root, ".github/workflows/release.yml"),
    "utf8",
  );
  expect(source).not.toMatch(
    /gh release (view|upload|download|edit|delete|create)/u,
  );
  const workflow = parse(source) as {
    jobs: Record<
      string,
      { outputs?: Record<string, string>; env?: Record<string, string> }
    >;
  };
  expect(workflow.jobs.draft!.outputs?.id).toBe(
    "${{ steps.release.outputs.id }}",
  );
  for (const job of ["binaries", "publish"])
    expect(workflow.jobs[job]!.env?.RELEASE_ID).toBe(
      "${{ needs.draft.outputs.id }}",
    );
});
