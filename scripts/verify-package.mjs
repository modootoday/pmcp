import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installPackage } from "./package-verification/install.mjs";
import { verifyContracts } from "./package-verification/contracts.mjs";

const args = process.argv.slice(2);
const values = new Map();
const flags = new Set();
for (let index = 0; index < args.length; index += 1) {
  const name = args[index];
  if (["--pack", "--matrix", "--report-stderr"].includes(name)) {
    flags.add(name);
    continue;
  }
  assert.ok(
    ["--archive", "--manager", "--runtime"].includes(name),
    `Unknown option ${name}`,
  );
  assert.ok(!values.has(name), `Duplicate option ${name}`);
  const value = args[++index];
  assert.ok(value && !value.startsWith("--"), `Missing value for ${name}`);
  values.set(name, value);
}
assert.notEqual(
  flags.has("--pack"),
  values.has("--archive"),
  "Supply --pack or --archive",
);
const directory = mkdtempSync(join(tmpdir(), "pmcp-packed-"));
try {
  let archive = values.has("--archive")
    ? resolve(values.get("--archive"))
    : undefined;
  if (flags.has("--pack")) {
    const packed = JSON.parse(
      execFileSync(
        "npm",
        ["pack", "--ignore-scripts", "--json", "--pack-destination", directory],
        { encoding: "utf8", timeout: 30_000 },
      ),
    );
    archive = join(directory, packed[0].filename);
  }
  const profiles = flags.has("--matrix")
    ? [
        { manager: "npm", runtime: "node" },
        { manager: "bun", runtime: "bun" },
      ]
    : [
        {
          manager: values.get("--manager") ?? "npm",
          runtime: values.get("--runtime") ?? "node",
        },
      ];
  const results = [];
  for (const profile of profiles) {
    const state = join(directory, `${profile.manager}-${profile.runtime}`);
    mkdirSync(state, { mode: 0o700 });
    const installed = installPackage(archive, state, profile.manager);
    results.push({
      ...profile,
      archiveSha256: installed.archiveSha256,
      packageManagerVersion: installed.managerVersion,
      ...(await verifyContracts(installed, profile.runtime)),
    });
  }
  const output = flags.has("--report-stderr") ? process.stderr : process.stdout;
  output.write(
    `${JSON.stringify({ status: "passed", qualification: "Actual packed-archive installation in empty temporary projects; no host dependencies or credentials copied; not Docker or OS qualification", results }, null, 2)}\n`,
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
