import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

// The native binaries ship as one npm package per platform, installed through the main
// package's optionalDependencies, so a user's npm fetches only the one matching os and cpu.
export const PLATFORMS = {
  "x86_64-unknown-linux-gnu": { os: "linux", cpu: "x64" },
  "aarch64-unknown-linux-gnu": { os: "linux", cpu: "arm64" },
  "x86_64-apple-darwin": { os: "darwin", cpu: "x64" },
  "aarch64-apple-darwin": { os: "darwin", cpu: "arm64" },
};
// The browser and desktop plugins drive X11 and systemd scopes, so they ship on Linux only.
const BINARIES = {
  linux: ["pmcp-pty", "pmcp-tui", "pmcp-browser", "pmcp-desktop"],
};
BINARIES.darwin = ["pmcp-pty", "pmcp-tui"];
// Linux binaries are built on ubuntu-22.04 runners, which sets the glibc floor. macOS binaries
// are unsigned: npm sets no quarantine flag, so they run when installed through npm.
const REQUIRES = {
  linux: "glibc 2.35 or later",
  darwin: "unsigned, for installs through npm",
};

const root = resolve(import.meta.dirname, "..");
const main = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

export function packageName({ os, cpu }) {
  return `${main.name}-${os}-${cpu}`;
}

// Writes <out>/<os>-<cpu>/ with package.json, README and bin/, from binaries in binDir.
export function writePlatformPackage(target, binDir, out) {
  const platform = PLATFORMS[target];
  assert.ok(platform, `Unknown target ${target}`);
  const directory = join(out, `${platform.os}-${platform.cpu}`);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(join(directory, "bin"), { recursive: true });
  const binaries = BINARIES[platform.os];
  for (const name of binaries) {
    const source = join(binDir, name);
    assert.ok(existsSync(source), `Missing ${source}`);
    copyFileSync(source, join(directory, "bin", name));
    chmodSync(join(directory, "bin", name), 0o755);
  }
  const requires = REQUIRES[platform.os];
  const manifest = {
    name: packageName(platform),
    version: main.version,
    description: `Native binaries of ${main.name} for ${platform.os}-${platform.cpu} (${requires})`,
    license: main.license,
    repository: main.repository,
    os: [platform.os],
    cpu: [platform.cpu],
    ...(platform.os === "linux" ? { libc: ["glibc"] } : {}),
    files: ["bin", "README.md"],
    preferUnplugged: true,
  };
  writeFileSync(
    join(directory, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  writeFileSync(
    join(directory, "README.md"),
    `# ${manifest.name}\n\n${binaries.join(", ")} for ${main.name} on ${platform.os}-${platform.cpu}, ${requires}. Install ${main.name}; npm selects this package for you.\n`,
  );
  return { directory, manifest, binaries };
}

// The optionalDependencies block the main package must carry for this version.
export function optionalDependencies() {
  return Object.fromEntries(
    Object.values(PLATFORMS).map((p) => [packageName(p), main.version]),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args[0] === "--optional-dependencies") {
    console.log(JSON.stringify(optionalDependencies(), null, 2));
  } else {
    const option = (name) => {
      const index = args.indexOf(name);
      assert.ok(index >= 0 && args[index + 1], `Missing ${name}`);
      return args[index + 1];
    };
    const written = writePlatformPackage(
      option("--target"),
      resolve(option("--bin-dir")),
      resolve(option("--out")),
    );
    console.log(
      JSON.stringify({
        directory: written.directory,
        name: written.manifest.name,
        binaries: written.binaries,
      }),
    );
  }
}
